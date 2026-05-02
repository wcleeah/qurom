<me>
How does the scheduler switch go routine running on a thread?
</me>

<agent>
## Go Scheduler: Goroutine Switching on a Thread

### The Scheduler Model (GMP)

```
G = Goroutine   (the unit of work)
M = Machine     (OS thread)
P = Processor   (logical CPU, holds run queue)

P1 ──► M1 (OS Thread)
│         currently running G1
│
RunQueue: [G2, G3, G4, ...]
```

Each `P` has a local run queue of goroutines. An `M` must hold a `P` to run goroutines.

---

### How a Switch Actually Happens

Go uses **cooperative + preemptive** scheduling (since Go 1.14).

#### 1. Cooperative Yield Points
The goroutine voluntarily gives up the thread at certain points:

```
- Channel send/receive (blocks)
- syscall entry
- runtime.Gosched()
- function call prologues (stack growth check)
- time.Sleep()
- sync.Mutex.Lock() (when contended)
```

At these points the runtime can swap in another `G` from the run queue.

#### 2. Preemption (Go 1.14+)
A background `sysmon` thread sends **SIGURG** signals to `M`s running goroutines that have been running too long (~10ms):

```
sysmon ──► detects G running > 10ms
       ──► sends SIGURG to M
       ──► signal handler sets preemption flag
       ──► G is interrupted at next safe point
```

This prevents a tight loop from starving other goroutines:
```go
// Pre-1.14: this would starve other goroutines
// Post-1.14: preempted by sysmon via SIGURG
for {
    x++
}
```

---

### The Actual Context Switch Mechanics

When a switch happens:

```
1. Save G's current state
   - program counter (PC)
   - stack pointer (SP)
   - registers → stored in G's gobuf struct

2. Pick next G from run queue
   - check local P queue first
   - then global queue
   - then work-steal from other P's queues

3. Restore next G's state
   - load its gobuf (PC, SP, registers)
   - resume execution
```

In Go runtime source, the key struct is `gobuf`:

```go
// simplified from runtime/runtime2.go
type gobuf struct {
    sp   uintptr  // stack pointer
    pc   uintptr  // program counter
    g    guintptr // owning goroutine
    ret  uintptr  // return value
    bp   uintptr  // base pointer
}
```

This is **much cheaper than an OS context switch** — no kernel mode transition, no full register save, no TLB flush.

---

### Blocking Syscalls: M Handoff

When a goroutine makes a **blocking syscall** (e.g. file read), the OS blocks the entire `M`:

```
G1 calls read() ──► M1 blocks in kernel
                ──► P detaches from M1
                ──► P attaches to M2 (new or idle thread)
                ──► M2 continues running G2, G3...

When read() returns:
G1 tries to reacquire a P
  → if one is free, continue
  → if none free, G1 goes to global run queue, M1 goes idle
```

This is why Go can have thousands of goroutines but only `GOMAXPROCS` active threads.

---

### Work Stealing

When a `P`'s local queue is empty:

```
P1 (empty) ──► check global run queue
           ──► if empty, steal from P2's queue
           ──► steals half of P2's goroutines
```

```go
// Roughly what the scheduler does
func findRunnable() *g {
    // 1. local run queue
    if g := runqget(p); g != nil { return g }

    // 2. global run queue (periodically checked)
    if g := globrunqget(p); g != nil { return g }

    // 3. work steal from random P
    if g := stealWork(p); g != nil { return g }

    // 4. check netpoller (network I/O ready goroutines)
    if g := netpoll(); g != nil { return g }

    return nil // park M
}
```

---

### Go vs OS Context Switch Cost

| | Go Goroutine Switch | OS Thread Switch |
|---|---|---|
| Mode transition | No (stays in userspace) | Yes (user → kernel) |
| Registers saved | Partial (only needed) | Full |
| Stack | Grows dynamically (2KB–1GB) | Fixed (1–8MB) |
| Cost | ~100ns | ~1–10µs |
| TLB flush | No | Sometimes |

---

### Visualizing a Full Cycle

```
G1 running on M1/P1
  │
  ├── hits channel receive (blocks)
  │     G1 state saved to gobuf
  │     G1 moved to channel's wait queue
  │
  ├── scheduler picks G2 from P1's run queue
  │     G2 state restored from gobuf
  │     G2 now running on M1/P1
  │
  ├── sysmon notices G2 ran > 10ms
  │     SIGURG sent to M1
  │     G2 preempted at safe point
  │     G2 put back in run queue
  │
  ├── channel sender unblocks G1
  │     G1 moved back to P's run queue
  │
  └── G1 eventually scheduled again
```

---

### Key Takeaways

- Switches happen at **yield points** (cooperative) or via **SIGURG** (preemptive)
- Context is saved in `gobuf` — fast, userspace only
- Blocking syscalls trigger **M handoff** to keep `P` busy
- **Work stealing** keeps all `P`s utilized
- The entire mechanism stays in **userspace** — far cheaper than OS thread switching
</agent>

<me>
You presented the theory, but i want the implementation:
1. How does a goroutine know it is in a blocking state
2. How does the goroutine signals the scheduler? Also if it is running on a single thread, it is doing an operation that is blocking, how does it switch to sending signals
3. What is sigurg, what is sysmon, how do they tie to the go scheduler
</me>

<agent>
## Go Scheduler: The Actual Implementation

### 1. How Does a Goroutine Know It's Blocking?

It doesn't — **the runtime knows**, not the goroutine itself. The goroutine just calls a runtime function and never returns until unblocked. The blocking is implemented **inside the runtime call**.

#### Channel Receive Example

```go
v := <-ch  // you write this
```

This compiles to a call to `runtime.chanrecv()`. Inside:

```go
// simplified from runtime/chan.go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    lock(&c.lock)

    // is there a sender waiting? grab directly
    if sg := c.sendq.dequeue(); sg != nil {
        recv(c, sg, ep, func() { unlock(&c.lock) })
        return true, true
    }

    // is there data in buffer? grab it
    if c.qcount > 0 { ... }

    // nothing available — we must block
    gp := getg()             // get current goroutine's *g struct
    mysg := acquireSudog()   // create a "suspended goroutine" record
    mysg.g = gp
    mysg.elem = ep           // where to put the value when it arrives

    c.recvq.enqueue(mysg)    // put ourselves on the channel's wait queue

    // ← THIS is the blocking call
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), ...)
    // goroutine does not return from gopark until unblocked
}
```

#### `gopark` — The Heart of Blocking

```go
// runtime/proc.go (simplified)
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, ...) {
    mp := acquirem()      // get current M
    gp := mp.curg         // get current G

    gp.waitLock = lock
    gp.parkingOnChan.Store(true)

    mcall(park_m)         // ← switch to scheduler stack and call park_m
}

func park_m(gp *g) {
    mp := getg().m

    casgstatus(gp, _Grunning, _Gwaiting)  // mark G as waiting
    dropg()                                // detach G from M

    // now M is free to run another G
    schedule()            // ← pick next goroutine and run it
}
```

`mcall` is a small assembly function that:
1. Saves the current goroutine's registers into its `gobuf`
2. Switches the stack pointer to the `M`'s scheduler stack
3. Calls the given function (`park_m`) on that scheduler stack

So the goroutine doesn't "signal" anything — it **calls into the runtime**, which saves its state and calls the scheduler directly.

---

#### What About Blocking Syscalls?

For OS-level blocking (file I/O, `read()`, etc.), Go wraps all syscalls:

```go
// runtime/syscall_linux.go (simplified)
func syscall(fn, a1, a2, a3 uintptr) uintptr {
    gp := getg()
    mp := gp.m

    // 1. tell scheduler: this M is about to block in a syscall
    entersyscall()
    // ↑ this marks gp as _Gsyscall and records the SP/PC
    // so the GC can scan the stack, and sysmon can detect it

    // 2. do the actual syscall (M blocks here in kernel)
    r := asmcall(fn, a1, a2, a3)

    // 3. coming back — try to reacquire P
    exitsyscall()

    return r
}

func entersyscall() {
    gp := getg()
    gp.m.oldp.set(gp.m.p.ptr())  // remember our P
    gp.m.p.ptr().status = _Psyscall  // mark P as in-syscall
    casgstatus(gp, _Grunning, _Gsyscall)
}
```

After `entersyscall()`, **sysmon** (explained below) can detect that this `P` is stuck and hand it off to another `M`.

---

### 2. How Does the Goroutine Signal the Scheduler on a Single Thread?

**It doesn't signal — it calls directly.** There is no signal sent from goroutine to scheduler for cooperative yielding. The goroutine runs runtime code that switches execution context using `mcall`.

#### The Stack Switch via `mcall`

```asm
// runtime/asm_amd64.s (simplified)
TEXT runtime·mcall(SB),NOSPLIT,$0-8
    // save current goroutine state into its gobuf
    MOVQ    (TLS), R14        // R14 = current G
    MOVQ    AX, R14           // store function pointer
    MOVQ    SP, (g_sched+gobuf_sp)(R14)   // save stack pointer
    MOVQ    0(SP), AX
    MOVQ    AX, (g_sched+gobuf_pc)(R14)   // save program counter

    // switch to M's scheduler stack (g0 stack)
    MOVQ    g_m(R14), R8
    MOVQ    m_g0(R8), R9      // g0 is the scheduler goroutine
    MOVQ    (g_sched+gobuf_sp)(R9), SP    // switch stack pointer to g0's stack

    // call the scheduler function (e.g. park_m, schedule)
    CALL    AX
```

Every `M` has a special goroutine called `g0` with its own stack — this is the **scheduler stack**. `mcall` switches from the current goroutine's stack to `g0`'s stack and runs scheduler code there.

```
User goroutine stack        g0 (scheduler) stack
───────────────────         ────────────────────
chanrecv()                  
  gopark()                  
    mcall() ──────────────► park_m()
                                casgstatus(G, _Gwaiting)
                                schedule()
                                    findRunnable()
                                    execute(nextG)
                                        gogo() ──► next goroutine runs
```

#### `gogo` — Resuming a Goroutine

```asm
// runtime/asm_amd64.s (simplified)
TEXT runtime·gogo(SB),NOSPLIT,$0-8
    MOVQ    buf+0(FP), BX     // load gobuf
    MOVQ    gobuf_g(BX), DX   // load G
    MOVQ    gobuf_sp(BX), SP  // restore stack pointer
    MOVQ    gobuf_pc(BX), BX  // restore program counter
    JMP     BX                // jump to where G left off
```

This is **not a function call** — it's a raw `JMP`. The goroutine resumes exactly where it was, as if nothing happened.

---

### 3. SIGURG and sysmon

#### `sysmon` — The Supervisor Thread

`sysmon` is a **native OS thread** (not managed by GMP, has no `P`) that runs in the background continuously:

```go
// runtime/proc.go (simplified)
func sysmon() {
    for {
        // sleep between 20µs and 10ms depending on activity
        usleep(delay)

        // 1. retract P from goroutines blocked in syscalls too long
        retake(now)

        // 2. check if any P needs preempting
        retake(now) // also calls preemptone() for long-running Gs

        // 3. run timers, netpoller, GC triggers...
        ...
    }
}

func retake(now int64) int32 {
    for i := range allp {
        pp := allp[i]
        pd := &pp.sysmontick

        s := pp.status
        if s == _Psyscall {
            // P stuck in syscall — hand it off if too long
            if now - pd.schedwhen > forcePreemptNS {
                handoffp(pp)  // give P to another M
            }
        } else if s == _Prunning {
            // goroutine running too long — preempt it
            if now - pd.schedwhen > forcePreemptNS {
                preemptone(pp)
            }
        }
    }
}
```

#### `SIGURG` — The Preemption Signal

`preemptone()` sends `SIGURG` to the OS thread running the target goroutine:

```go
// runtime/signal_unix.go (simplified)
func preemptone(pp *p) bool {
    mp := pp.m.ptr()
    gp := mp.curg

    gp.preempt = true           // set flag (cooperative fallback)
    gp.stackguard0 = stackPreempt

    // async preemption: send signal to the OS thread
    preemptM(mp)
    return true
}

func preemptM(mp *m) {
    signalM(mp, sigPreempt)  // sigPreempt = SIGURG
}
```

**Why SIGURG specifically?**
- It's the "urgent data on socket" signal
- Almost no real programs use it
- It can be delivered at any point (unlike some signals that are blocked)
- It was chosen to minimize interference with user code ([Go proposal](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md))

#### The SIGURG Handler

Each `M` registers a handler for SIGURG:

```go
// runtime/signal_sighandler.go (simplified)
func sighandler(sig uint32, info *siginfo, ctxt *sigctxt, gp *g) {
    if sig == sigPreempt {
        // check this is actually a preemption request
        if doSigPreempt(gp, ctxt) {
            // inject a call to asyncPreempt into the goroutine's stack
            ctxt.pushCall(abi.FuncPCABI0(asyncPreempt))
        }
        return
    }
    // ... handle other signals
}
```

`ctxt.pushCall` **modifies the goroutine's saved register state** in the signal context to inject a call to `asyncPreempt` — so when the signal handler returns, the goroutine resumes but immediately calls `asyncPreempt` instead of its original instruction:

```go
// runtime/preempt.go
func asyncPreempt() {
    // save all registers (full register save needed since
    // we interrupted at an arbitrary point)
    asyncPreempt2()
}

func asyncPreempt2() {
    gp := getg()
    gp.asyncSafePoint = true
    if gp.preemptStop {
        mcall(preemptPark)   // STW requested — park goroutine
    } else {
        mcall(gopreempt_m)   // normal preemption — back to run queue
    }
}

func gopreempt_m(gp *g) {
    gp.asyncSafePoint = false
    goschedImpl(gp)   // put G back in run queue, call schedule()
}
```

---

### Full Flow: Tight Loop Preemption

```
G1 running tight loop on M1
  │
  │  [every ~10ms]
  ▼
sysmon wakes up
  └─► retake() sees P1 has been running > 10ms
  └─► preemptone(P1)
        └─► signalM(M1, SIGURG)
              │
              ▼
        OS delivers SIGURG to M1's thread
              │
              ▼
        sighandler() runs (on M1, interrupting G1)
              └─► ctxt.pushCall(asyncPreempt)
              │
              ▼
        signal returns → G1 now calls asyncPreempt()
              └─► mcall(gopreempt_m)
                    └─► G1 saved to gobuf
                    └─► G1 put back in run queue
                    └─► schedule() picks next G
                    └─► gogo() resumes G2
```

---

### Summary

| Question | Answer |
|---|---|
| How does G know it's blocking? | It doesn't — it calls a runtime func that calls `gopark()` |
| How does cooperative switch happen? | `mcall()` saves state, switches to `g0` scheduler stack, calls `schedule()` |
| How does preemption work on a single thread? | `sysmon` sends SIGURG; signal handler injects `asyncPreempt` into G's execution |
| What is `sysmon`? | A bare OS thread (no P) that polls for stuck Gs and syscalls |
| What is SIGURG? | The Unix signal repurposed by Go as a preemption interrupt |
| How does G resume? | `gogo()` does a raw `JMP` back to the saved program counter |
</agent>

<me>
- you use channel as example, is parking applied to other blocking ops (eg: mutex contention)
- so all syscall forces a switch on m?
- sysmon is part of the scheduler go code right? It is running on a separate thread than those used by goroutines. If thats the case, the statement go uses exactly gomaxproc threads is incorrect?
</me>

<agent>
## Clarifications on Go Scheduler Details

### 1. Is `gopark` Used for Mutex Contention?

Yes — `gopark` is the **universal primitive** for blocking in Go. It's used across all blocking operations:

```go
// runtime/sema.go — the backing implementation for sync.Mutex
func semacquire1(addr *uint32, lifo bool, profile semaProfileFlags, skipframes int) {
    gp := getg()

    // fast path: uncontended
    if cansemacquire(addr) {
        return
    }

    // slow path: must block
    s := acquireSudog()
    // ... add to mutex wait queue (treap structure) ...

    for {
        goparkunlock(&root.lock, waitReasonSemacquire, ...)
        // ↑ same gopark, resumes here when semrelease wakes us
        if s.ticket != 0 || cansemacquire(addr) {
            break
        }
    }
}
```

`sync.Mutex` itself is built on top of `runtime_SemacquireMutex` which calls into `semacquire1`. So the chain is:

```
sync.Mutex.Lock()
  └─► runtime_SemacquireMutex()
        └─► semacquire1()
              └─► gopark()        ← same primitive as channels
                    └─► mcall(park_m)
                          └─► schedule()
```

Other things that use `gopark`:

```
sync.Mutex contention     ──► gopark (via semacquire)
sync.WaitGroup.Wait()     ──► gopark (via semacquire)
sync.Cond.Wait()          ──► gopark (via semacquire)
channel send/recv         ──► gopark (via chanrecv/chansend)
time.Sleep()              ──► gopark (via timer)
network I/O               ──► gopark (via netpoller)
runtime.Gosched()         ──► directly calls schedule()
select (all blocked)      ──► gopark on all channels simultaneously
```

`gopark` is essentially **the only way a goroutine blocks** in the Go runtime.

---

### 2. Do All Syscalls Force a Switch on M?

**No — it depends on whether the syscall blocks.**

Go distinguishes between two kinds:

#### Non-blocking Syscalls (fast path)
The runtime tries the syscall directly. If the OS returns immediately (e.g. reading from a file already in page cache, `getpid()`, `clock_gettime()`):

```
G1 calls syscall
  └─► entersyscall() — marks G as _Gsyscall
  └─► executes syscall — returns immediately
  └─► exitsyscall() — reclaims P, continues
  No switch happens. M never releases P.
```

#### Network I/O — Converted to Non-blocking
Go converts all network syscalls to **non-blocking** using `epoll`/`kqueue`/`IOCP` via the **netpoller**:

```
G1 calls net.Read()
  └─► non-blocking read() → returns EAGAIN (not ready)
  └─► G1 registers fd with netpoller (epoll_ctl)
  └─► gopark() — G1 parks, M is free
  └─► [later] netpoller detects fd ready via epoll_wait
  └─► G1 put back in run queue
  └─► G1 resumes, retries read()
```

This is why thousands of concurrent connections don't need thousands of OS threads.

#### Blocking Syscalls (slow path)
Truly blocking syscalls (e.g. disk I/O, `cgo`, some `ioctl`s) cannot be made non-blocking:

```go
func entersyscallblock() {
    gp := getg()
    
    // proactively hand off P before even doing the syscall
    // because we KNOW this will block
    handoffp(releasep())  // ← P given to another M immediately
    
    // now do the blocking syscall on this M (no P held)
    // other goroutines continue on the handed-off P
}
```

For regular syscalls where we're not sure:
```
entersyscall()        ← P marked as _Psyscall but not released yet
  syscall blocks...
  [sysmon notices after ~20µs]
  sysmon calls handoffp(P) ── P handed to idle M or new M spawned
  [syscall returns]
exitsyscall()
  try to reacquire a P
    → if P is free: continue on same M
    → if no P free: G goes to global queue, M goes idle
```

So **not every syscall causes a switch** — only blocking ones, and even then there's a grace period before `sysmon` intervenes.

---

### 3. Does sysmon Break the "GOMAXPROCS Threads" Statement?

**Yes — that statement is imprecise.** The correct statement is:

> Go uses at most `GOMAXPROCS` threads **to run goroutines simultaneously**, but the total number of OS threads can be higher.

#### Threads Beyond GOMAXPROCS

```
Threads running goroutines:     GOMAXPROCS (these hold a P)
sysmon thread:                  +1 (no P, always running)
threads in blocking syscalls:   +N (no P, blocked in kernel)
cgo threads:                    +N (no P, in C code)
runtime internal threads:       +few (finalizer, timer, etc.)

Total OS threads = GOMAXPROCS + sysmon + blocked syscall Ms + cgo Ms + ...
```

You can observe this yourself:

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)  // only 2 Ps

    // spawn goroutines doing blocking syscalls
    for range 100 {
        go func() {
            time.Sleep(10 * time.Second) // parks, doesn't block M
        }()
    }

    // this would show > 2 threads if we used real blocking syscalls
    fmt.Println(runtime.NumGoroutine())
}
```

With real blocking syscalls (e.g. reading from a slow device), you'd see `GOMAXPROCS + N` threads via:

```bash
# observe actual thread count of a Go process
cat /proc/<pid>/status | grep Threads
```

#### The Thread Cap

Go does have a hard cap via `runtime/debug`:

```go
debug.SetMaxThreads(10000) // default is 10000
```

If this is exceeded (e.g. too many blocking syscalls simultaneously), the program crashes with:

```text
runtime: program exceeds 10000-thread limit
fatal error: thread exhaustion
```

#### Summary of Thread Types

| Thread | Holds P? | Counts toward GOMAXPROCS? | Purpose |
|---|---|---|---|
| Normal M running G | ✅ | ✅ | Run goroutines |
| M in blocking syscall | ❌ | ❌ | Waiting in kernel |
| M after syscall (no P avail) | ❌ | ❌ | Idle, in M free list |
| `sysmon` | ❌ | ❌ | Scheduler supervisor |
| cgo M | ❌ | ❌ | C code execution |
| Finalizer thread | ❌ | ❌ | GC finalizers |

So `GOMAXPROCS` controls **parallelism of goroutine execution**, not the total OS thread count.
</agent>
