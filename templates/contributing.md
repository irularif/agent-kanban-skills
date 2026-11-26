## en

## Work tracking

Work is tracked on the GitHub Project board: {{url}}

Flow: plan -> `/plan-to-issues` -> `/start-issue <n>` -> PR whose body has `Closes #n` -> merge -> Done.

Status meanings:

- **Triage**: inbox. Issues created by hand land here until someone sorts them.
- **Backlog**: accepted, not scheduled.
- **Ready**: scoped and ready to pick up.
- **In progress**: someone is working on it (`/start-issue <n>` moves it here).
- **In review**: a pull request is open. A PR whose body has `Closes #n` moves the card here automatically, once the "Pull request linked to issue -> In review" workflow step is enabled on the board.
- **Done**: the PR was merged and the issue closed.

Areas: {{areas}}. Every issue gets one `area:` label and a Size (S, M, L).

The git hooks installed by `/init-kanban` only warn, they never block: `post-checkout` flags a new branch whose name has no issue number, and `pre-push` flags a push when the issue's card is not In progress or In review.

## id

## Pelacakan pekerjaan

Pekerjaan dilacak di papan GitHub Project: {{url}}

Alur: rencana -> `/plan-to-issues` -> `/start-issue <n>` -> PR dengan `Closes #n` di deskripsinya -> merge -> Done.

Arti setiap status:

- **Triage**: kotak masuk. Issue yang dibuat manual masuk ke sini sampai ada yang memilahnya.
- **Backlog**: sudah diterima, belum dijadwalkan.
- **Ready**: sudah jelas lingkupnya dan siap dikerjakan.
- **In progress**: sedang dikerjakan (`/start-issue <n>` memindahkan ke sini).
- **In review**: pull request sudah dibuka. PR yang deskripsinya memuat `Closes #n` memindahkan kartu ke sini secara otomatis, setelah langkah workflow "Pull request linked to issue -> In review" diaktifkan di papan.
- **Done**: PR sudah di-merge dan issue tertutup.

Area: {{areas}}. Setiap issue mendapat satu label `area:` dan Size (S, M, L).

Git hook yang dipasang oleh `/init-kanban` hanya memberi peringatan dan tidak pernah memblokir: `post-checkout` memperingatkan branch baru yang namanya tanpa nomor issue, dan `pre-push` memperingatkan jika kartu issue belum berstatus In progress atau In review.
