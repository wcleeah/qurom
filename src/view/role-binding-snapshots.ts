import type { RoleBindingSnapshotSummary } from "../config-store"
import { card, section } from "./html"
import { escapeHtml } from "./utils"

function confirmSubmit(message: string) {
  return `onsubmit="return confirm(${escapeHtml(JSON.stringify(message))})"`
}

function snapshotChip(snapshot: RoleBindingSnapshotSummary) {
  if (!snapshot.isLastUsed) return ""
  if (snapshot.matchesLive) {
    return `<span class="status-chip matches" title="Live role bindings match this snapshot">Matches</span>`
  }
  return `<span class="status-chip diverted" title="Live role bindings have changed since this snapshot was last saved or applied">Modified from snapshot</span>`
}

function snapshotAction(input: {
  action: string
  label: string
  confirm: string
  className?: string
}) {
  return `<form class="inline-form" method="POST" action="${escapeHtml(input.action)}" data-snapshot-form ${confirmSubmit(input.confirm)}>
  <button type="submit" class="${escapeHtml(input.className ?? "btn")}">${escapeHtml(input.label)}</button>
</form>`
}

export function renderRoleBindingSnapshotsSection(input: {
  snapshots: RoleBindingSnapshotSummary[]
  error?: string
}): string {
  const error = input.error
    ? `<div class="outcome-banner failed">${escapeHtml(input.error)}</div>`
    : ""
  const saveForm = `<form class="config-form binding-snapshot-save" method="POST" action="/config/roles/snapshots" data-snapshot-form onsubmit="var n=(this.querySelector('[name=name]')||{}).value; n=n?String(n).trim().replace(/\\s+/g,' '):''; return confirm('Save current role bindings as ' + JSON.stringify(n || 'untitled') + '?')">
  <label class="form-field"><span>Save current as</span>
    <input class="form-input" name="name" required maxlength="80" placeholder="cheap mix" autocomplete="off">
  </label>
  <div class="form-actions"><button type="submit" class="btn btn-primary">Save snapshot</button></div>
</form>`

  if (input.snapshots.length === 0) {
    return section("Binding snapshots", `${error}
<p class="tiny-text muted-text">No snapshots. Save the current bindings to switch back later. Snapshots live on this active profile only and do not change shipped defaults.</p>
${saveForm}`)
  }

  const cards = input.snapshots.map((snapshot) => {
    const id = String(snapshot.id)
    const applyPath = `/config/roles/snapshots/${id}/apply`
    const overwritePath = `/config/roles/snapshots/${id}/overwrite`
    const renamePath = `/config/roles/snapshots/${id}/rename`
    const deletePath = `/config/roles/snapshots/${id}/delete`
    const roleLabel = snapshot.roleCount === 1 ? "1 role" : `${snapshot.roleCount} roles`
    return card(`<div class="binding-snapshot-card">
  <div class="binding-snapshot-heading">
    <h3>${escapeHtml(snapshot.name)} ${snapshotChip(snapshot)}</h3>
    <p class="tiny-text muted-text">${escapeHtml(roleLabel)}</p>
  </div>
  <div class="form-actions binding-snapshot-actions">
    ${snapshotAction({
      action: applyPath,
      label: "Apply",
      className: "btn btn-primary",
      confirm: `Apply ${JSON.stringify(snapshot.name)} to live bindings? This overwrites ${snapshot.roleCount} role binding${snapshot.roleCount === 1 ? "" : "s"}.`,
    })}
    ${snapshotAction({
      action: overwritePath,
      label: "Overwrite",
      confirm: `Replace snapshot ${JSON.stringify(snapshot.name)} with the current live bindings?`,
    })}
    ${snapshotAction({
      action: deletePath,
      label: "Delete",
      className: "btn btn-secondary",
      confirm: `Delete snapshot ${JSON.stringify(snapshot.name)}?`,
    })}
  </div>
  <form class="config-form binding-snapshot-rename" method="POST" action="${escapeHtml(renamePath)}" data-snapshot-form>
    <label class="form-field"><span>Rename</span>
      <input class="form-input" name="name" required maxlength="80" value="${escapeHtml(snapshot.name)}" autocomplete="off">
    </label>
    <div class="form-actions"><button type="submit" class="btn">Rename</button></div>
  </form>
</div>`)
  })

  return section("Binding snapshots", `${error}
<p class="tiny-text muted-text">Named copies of the live role bindings on this profile. Apply restores a snapshot; card edits do not change it until you overwrite.</p>
${saveForm}
<div class="binding-snapshot-list">${cards.join("\n")}</div>`)
}
