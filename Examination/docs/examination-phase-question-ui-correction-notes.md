# Question UI Correction Notes

## What Changed

- Normal question editor no longer asks for chapter or topic.
- Per-question marks and negative marks are hidden from the teacher UI.
- MCQ options are fixed to exactly four rows: A, B, C, and D.
- MCQ option text is optional.
- Correct answer is chosen with a right-side selector.
- Question and solution images remain the only media types.
- No option image type was added.

## Scoring Behavior

- Marks and negative marks are taken from the selected section defaults.
- Android sends section-level values automatically.

## Media Flow

- Teacher saves the question shell first.
- QUESTION and SOLUTION media panels appear on the saved question editor.
- Image actions use upload/select from device only.
