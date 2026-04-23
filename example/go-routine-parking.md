# Go Routine Parking

## Short answer

A goroutine is “parked” when the Go runtime changes that goroutine from **running** to **waiting** and removes it from runnable scheduler work. The important part is what does **not** necessarily stop: the OS thread and the runtime execution slot that were running that goroutine can often go run something else.

In runtime terms, `gopark` performs the park, and `goready` makes a parked goroutine runnable again. Higher-level operations like channel send/receive, `select`, `time.Sleep`, and semaphore-based synchronization build on that same mechanism. This is documented in the Go runtime’s scheduler notes and source code, especially `src/runtime/HACKING.md`, `src/runtime/proc.go`, `src/runtime/chan.go`, `src/runtime/select.go`, `src/runtime/time.go`, and `src/runtime/sema.go`.

## Starting point, driving question, and finish line

The starting point is a common confusion: you know goroutines are lightweight, and you have seen code block on channels, `time.Sleep`, `select`, or `sync` primitives, but it is still fuzzy what the runtime actually parks, what keeps running, and why blocked goroutines usually do not waste an OS thread.

The driving question is:

> When a goroutine cannot make progress, what exactly does the Go runtime do to park it, how is it made runnable again, and how is that different from blocking an OS thread?

The finish line is this plain-English statement:

> A parked goroutine is a waiting **G** removed from the run queue. Its **M** (OS thread) and **P** (the right/resources to run Go code) can usually keep doing work. Runtime code like `gopark` and `goready` performs the state change, and higher-level operations such as channel send, `select`, sleep, and semaphores build on that mechanism.

We will reuse one small example throughout:

```go
ch := make(chan int)

go func() {
    ch <- 1 // goroutine A
}()

x := <-ch // goroutine B
_ = x
```

Assume A reaches `ch <- 1` before B is ready. The whole deep dive is about what the runtime does next, and then how B eventually wakes A back up.

## Core mental model

The first thing to separate is the runtime’s three scheduler objects:

- **G** = goroutine
- **M** = OS thread
- **P** = the resources required to execute Go code, including scheduler state

The Go runtime explains this split in `src/runtime/HACKING.md` and again in the scheduler comments at the top of `src/runtime/proc.go`. `HACKING.md` says the scheduler’s job is to “match up a G, an M, and a P.” That matters because parking only makes sense once those roles are separate.

The short answer for this section is: **the goroutine is what gets parked**. In runtime terms, a **G** changes from running to waiting and leaves runnable scheduler work. That does **not** automatically mean the OS thread goes to sleep.

Apply that to the running example. If goroutine A reaches `ch <- 1` before B is ready to receive, A cannot make progress. In the runtime’s terms, A’s **G** is parked: it moves to a waiting state and is removed from the run queue. `HACKING.md` says this directly: `gopark` parks the current goroutine by putting it in the “waiting” state and removing it from the scheduler’s run queue, then another goroutine is scheduled on the current M/P.

That is why “goroutine blocked” and “thread blocked” are not the same statement.

The runtime’s synchronization table in `HACKING.md` makes this even clearer. It says:

- `park` blocks **G**, but not **M** or **P**
- a runtime `mutex` blocks **G**, **M**, and **P**
- a runtime `note` blocks **G** and **M**, with **P** depending on the path

So when people say “the goroutine is parked,” the careful meaning is not “the whole thread is asleep.” It is “this goroutine is waiting and no longer runnable.”

That is the mental model to carry through the rest of the document:

1. a goroutine hits an operation that cannot proceed,
2. the runtime parks that **G**,
3. the **M** and **P** can often keep serving other work,
4. later some event makes the parked **G** runnable again.

## Step-by-step explanation

The direct answer is: **when goroutine A tries to send on an unbuffered channel with no receiver ready, the runtime records A as a waiting sender, marks A as parking on the channel, and calls `gopark`, which moves A from running to waiting so something else can run. Later, B’s receive finds A, completes the handoff, and makes A runnable again.**

Keep the example in view:

```go
ch := make(chan int)

go func() {
    ch <- 1 // goroutine A
}()

x := <-ch // goroutine B
_ = x
```

### How A parks

#### 1) `chansend` discovers that A cannot complete the send

In `src/runtime/chan.go`, the send entry point is `chansend`. For a blocking send, if there is no receiver ready to take the value immediately, the runtime takes the slow path. That is the path where parking happens.

Plain English: A tried to hand off `1`, but nobody was there to take it, so the runtime has to remember “A is waiting to send on this channel.”

#### 2) The runtime creates wait state for A

Before parking A, `chan.go` creates bookkeeping for the blocked send. This includes a `sudog`, which is runtime wait metadata. A `sudog` is not a goroutine itself. It is a record saying this goroutine is waiting in some synchronization structure.

The runtime links that wait record into the channel’s send queue and stores the element pointer so the value can be handed off later when a receiver arrives.

#### 3) A marks itself as parking on the channel

Right before the actual park, the channel send path sets channel-related park state, including:

- `gp.parkingOnChan.Store(true)`
- a wait reason such as `waitReasonChanSend`

and then calls `gopark(...)`.

That wait reason matters because it is what later appears in diagnostics like goroutine dumps and execution traces. When tooling says a goroutine is blocked on `chan send`, that label comes from runtime code, not from a guess.

#### 4) `gopark` changes A from running to waiting

`src/runtime/proc.go` says `gopark` “puts the current goroutine into a waiting state.” `src/runtime/HACKING.md` adds the scheduler-level view: `gopark` removes the goroutine from the run queue and schedules another goroutine on the current M/P.

This is the key transition. After this point, A is no longer runnable work.

That does **not** mean the thread is gone. It means the runtime has stopped scheduling A and can use that execution slot for some other goroutine, including B.

#### 5) The runtime is careful about lock ordering

One subtle but important detail from `proc.go`: the unlock function associated with `gopark` runs **after** the goroutine has been put into a waiting state. The comment warns that the goroutine may already have been readied by the time the unlock callback runs unless external synchronization prevents it.

That sounds low-level, but it explains why the runtime cannot just “unlock, then maybe park” in a casual order. Another goroutine could race in and satisfy the wait condition. The park transition and the synchronization around the channel lock have to line up correctly.

So the end of the park half is simple: A is now waiting in the channel’s send queue, not runnable, and no longer competing for CPU.

### How A wakes up

Now switch to B.

#### 1) B’s receive checks for a waiting sender

In `src/runtime/chan.go`, the receive path checks whether a sender is already waiting on the channel. For an unbuffered channel, that is the important case: if a sender is already queued, the runtime can match sender and receiver directly.

In plain language: when B executes `<-ch`, the runtime asks, “Is someone already blocked trying to send here?” In our example, the answer is yes: A.

#### 2) The runtime completes the handoff using A’s saved wait metadata

A was not parked as a bare goroutine. It was parked with channel-specific wait metadata stored in the send queue. The receive path takes that waiting sender record and uses it to finish the send/receive operation.

For an unbuffered channel, the value is copied directly from sender to receiver as part of this match. So B receives the `1` that A had been trying to send.

The important part for our throughline is not the exact copy routine. It is this: **B’s receive is the event that satisfies A’s wait condition.**

#### 3) The runtime makes A runnable again

Once the handoff is complete, the runtime wakes the sender. The scheduler primitive for that is `goready`, defined in `src/runtime/proc.go`. `HACKING.md` summarizes its behavior: `goready` puts a parked goroutine back in the runnable state and adds it to a run queue.

That gives us the precise state change:

- before B receives: A is **waiting**
- after B matches the send: A is **runnable**
- later, when scheduled onto an M with a P: A is **running**

#### 4) Runnable is not the same as running

This distinction matters in practice. A lot of engineers compress “woken up” and “currently executing” into one idea. The runtime does not.

`goready` makes A eligible to run by putting it back on scheduler work queues. But A still needs an M and a P. If B is currently running and keeps the CPU for a bit longer, A may sit briefly in runnable state before it actually resumes.

That is why the right summary is:

1. A tried to send and got parked.
2. B arrived and matched with A.
3. The runtime completed the value handoff.
4. The runtime changed A from waiting back to runnable.
5. The scheduler eventually ran A again.

That is the core mechanic behind goroutine parking.

## Real system or source-code evidence

The next question is whether this is just a channel detail. It is not. **Parking is a general runtime pattern.** Channels are one visible example, but the same scheduler-level idea shows up in `select`, `time.Sleep`, and semaphore-backed synchronization used by `sync`.

The recurring pattern is:

1. detect that a goroutine cannot make progress yet,
2. record why and what it is waiting on,
3. call `gopark` or `goparkunlock`,
4. later call `goready` or equivalent wake-up logic,
5. let the scheduler run the goroutine again when an M with a P is available.

### `select`

In `src/runtime/select.go`, the select implementation first looks for any case that can proceed immediately. If none can, and the `select` is blocking, it enqueues wait records on the relevant channel queues, sets channel-park state, and calls:

```go
gopark(selparkcommit, nil, waitReason, traceBlockSelect, 1)
```

The same file also has a special case for `select {}` with no cases:

```go
gopark(nil, nil, waitReasonSelectNoCases, traceBlockForever, 1)
```

So `select` is not a magical language feature that bypasses the scheduler. It explicitly parks the goroutine with a wait reason.

### `time.Sleep`

In `src/runtime/time.go`, `timeSleep` computes the wake-up time and then parks the current goroutine:

```go
gopark(resetForSleep, nil, waitReasonSleep, traceBlockSleep, 1)
```

Later in the same file, the timer callback that wakes the goroutine does:

```go
goready(arg.(*g), 0)
```

This is especially strong evidence because both sides are visible in one place:

- sleep path: park the current goroutine
- timer firing path: mark that goroutine runnable again

So `time.Sleep` is the same scheduler story as the channel example, just with a timer instead of a channel partner.

### Semaphore-backed synchronization

In `src/runtime/sema.go`, semaphore waiters also park explicitly. One path queues a waiter and then does:

```go
goparkunlock(&root.lock, reason, traceBlockSync, 4+skipframes)
```

Another condition-variable-style path does:

```go
goparkunlock(&l.lock, waitReasonSyncCondWait, traceBlockCondWait, 3)
```

This matters because much of `sync` builds on runtime semaphore mechanisms. So even if your application never touches channels, you still see the same parking pattern under mutex contention, condition waits, and related synchronization paths.

### Wait reasons in dumps and traces

This is not just internal bookkeeping. In `src/runtime/proc.go`, the `gopark` comments say the **reason** explains why the goroutine has been parked and that it is displayed in stack traces and heap dumps.

That is why blocked goroutines often show readable reasons like:

- `chan send`
- `select`
- `sleep`
- sync-related waits

Those labels come from the runtime’s own wait-reason plumbing.

### What is confirmed and what is inferred

It is **confirmed** by the source code that channels, `select`, sleep, and semaphore-based synchronization all explicitly use park/wake mechanisms in the runtime.

It is **inferred**, but strongly supported, that this common design is one reason Go can support large numbers of waiting goroutines without needing a one-thread-per-blocked-task model. The runtime code does not market that conclusion in those words, but the scheduler structure clearly points that way.

## Failure modes or misconceptions

The main failure mode in understanding goroutine parking is collapsing several different states into one vague idea of “blocked.” In Go, a blocked goroutine, a blocked OS thread, a yielded goroutine, and an idle worker thread are related ideas, but they are not the same thing.

### Misconception 1: “blocked goroutine” means “blocked thread”

This is the most common mistake. The runtime’s own synchronization table says `park` blocks the **G**, but not the **M** or **P**. So if A blocks on `ch <- 1`, A’s goroutine becomes waiting, but the runtime can still use the same M/P to run B or some unrelated runnable goroutine.

So “goroutine blocked” often means “this unit of work stopped,” not “this OS thread is asleep.”

### Misconception 2: `Gosched()` parks a goroutine

It does not.

`src/runtime/proc.go` says:

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

That is different from `gopark`, which moves the goroutine into a waiting state. `Gosched()` is a yield. Parking is an event-based wait.

### Misconception 3: if goroutines are parked, no thread can be sleeping

That is also wrong. The runtime manages **goroutine parking** and **worker-thread parking** separately.

At the top of `src/runtime/proc.go`, the scheduler comments discuss worker-thread parking and unparking as a separate problem. The runtime tries to keep enough running threads to use available parallelism, but also park excess threads to save CPU and power.

So two things can both be true:

- some goroutines are parked because they are waiting on channels, timers, or sync events
- some worker threads are parked because there is not enough runnable work to justify keeping them spinning

You have to ask what is parked: the goroutine, the worker thread, or both under different conditions.

### Misconception 4: all blocking paths are equivalent

They are not. `HACKING.md` explicitly distinguishes `park`, `mutex`, and `note`.

- `park` blocks **G**
- `mutex` blocks **G**, **M**, and **P**
- `note` blocks **G** and **M**, with **P** depending on the path

That means two code paths can both look “blocked” from far away while having different scheduler consequences. A parked goroutine on a channel wait is not the same event as a low-level runtime mutex stall.

### Practical failure mode: parked forever

It is easy to hear “parked goroutines are normal” and overcorrect into “parked goroutines are never a problem.” That is false.

A parked goroutine is healthy only if its wake-up condition can really happen. In the running example, A parks on `ch <- 1` and later B receives, so A becomes runnable again. That is normal.

But if no goroutine will ever receive from `ch`, then A is not just “temporarily parked.” It is parked forever.

The same pattern appears with:

- a `select` waiting on channels that never become ready
- a `sync.Cond` wait with a missing signal
- a sleep or timer path where the expected wake-up logic is broken
- semaphore waits where no corresponding release happens

The confirmed mechanics are that parked goroutines depend on later wake-up actions like `goready` or code paths that eventually call it. The practical conclusion is an inference from those mechanics: a pile of parked goroutines can indicate a leak, deadlock, or starvation issue if nothing will satisfy their wait conditions.

## Practical rules of thumb

Here are the simplest rules that help in real systems.

### 1) When you see channel, `select`, sleep, or sync waits, start with “parked G”

If a dump or trace shows a goroutine waiting in channel send, `select`, sleep, or a sync-related wait, your first question should be:

> What event is this goroutine waiting for?

In our running example, if A is stuck at `ch <- 1`, the first explanation is not “the CPU vanished.” It is “A is parked until some receiver shows up.”

### 2) Separate two latency questions

If latency is surprising, ask two separate questions:

1. **Why did this goroutine park?**
2. **Why did it take so long after becoming runnable to run again?**

Those are different problems.

In the running example:

- if B does not receive for 500 ms, A is parked for 500 ms because the event did not happen yet
- if B receives quickly, but A still resumes later than expected, the issue is after wake-up, in scheduling or system load

That distinction comes straight from the runtime state model: waiting, runnable, and running are different states.

### 3) Use dumps and execution traces as evidence

The runtime exposes wait reasons for debugging on purpose. `proc.go` says the park reason is shown in stack traces and heap dumps, and `HACKING.md` recommends execution traces for understanding scheduler behavior.

So in production debugging:

- use goroutine dumps to see **what goroutines are waiting on**
- use execution traces to see **when they parked, when they became runnable, and when they actually ran**

That is more reliable than guessing from application logs alone.

### 4) Many parked goroutines can be normal

A server can easily have many parked goroutines:

- idle request handlers
- workers waiting on channels
- timer-based goroutines
- condition waits

That is not automatically a problem.

The follow-up question is always:

> What wakes them?

If you cannot point to a real wake-up condition—a receiver, a sender, a timer firing, a semaphore release, a condition signal—then the parked state may be hiding a leak or deadlock.

### 5) Keep one plain-English sentence in mind

If you need one sentence to carry into debugging, use this:

> Parking is the Go runtime’s way to stop a goroutine from competing for CPU until the event it needs has happened.

That is the finish line of the whole deep dive. If you can explain a blocked path that way, you are usually reasoning about goroutine parking correctly.

## Sources

Primary sources used for the core claims in this draft:

- Go runtime scheduler overview and synchronization notes: `https://go.dev/src/runtime/HACKING`
- Go scheduler implementation, `gopark`, `goready`, `Gosched`, and wait-reason comments: `https://go.dev/src/runtime/proc.go`
- Go channel send/receive implementation and channel parking paths: `https://go.dev/src/runtime/chan.go`
- Go `select` implementation and parking paths: `https://go.dev/src/runtime/select.go`
- Go `time.Sleep`, timer wake-up, and `goroutineReady`: `https://go.dev/src/runtime/time.go`
- Go semaphore and condition-wait parking paths: `https://go.dev/src/runtime/sema.go`

Supporting source used for the scheduler’s synchronization guarantees around channels:

- Go memory model: `https://go.dev/ref/mem`
