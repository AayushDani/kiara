# Exact action timing

An owner plans an action against the current proposal, choosing either **now** or a specific **not before** instant. A delayed action stores a canonical UTC timestamp and the owner's reason. Planning records the choice; it does not schedule or send anything. The proposal's reviewed notice matrix is displayed beside the plan so a contractual timing description is visible without Kiara turning it into an inferred send date.

The browser converts a selected local date and time to UTC before saving. It rejects a nonexistent clock time during a daylight-saving jump and requires an explicit UTC occurrence choice when the same local time repeats. The frozen publisher authorization displays the proposal's exact notice rows and refuses a changed proposal or action.

The action content fingerprint includes timing, content, title, kind, recipients, destination and proposal identity. Exact authorization must remain valid past a delayed start. The execution preview repeats the timing choice. Both manual completion and the provider broker reject an attempt before the stored instant; the broker checks again in its final dispatch transaction after asynchronous preparation. A changed action fingerprint fails the final authority check. Existing actions without a timing field keep their original fingerprint and immediate behavior for compatibility.

The current flow does not automatically wake and dispatch at the chosen time. The owner or an authorized dispatcher must take a separate action, and all evidence, permissions, decisions and provider configuration are checked again at that point. A notice assessment alone does not authorize delivery. A complete notice requires exact recipients and an approved delivery channel before any live send.

Authorization also assigns an open action task to the exact publisher or signatory. Manual evidence or provider readback completes that task; a failed effect blocks it while reconciliation remains owned. A reviewed no-action decision can cancel an unsent action and retire its task without claiming delivery.

Synthetic execution tests cover a premature manual attestation and provider dispatch, a later dispatch after the boundary, malformed timing, and authorization that expires before the planned start. Provider calls in these tests use local adapters only.
