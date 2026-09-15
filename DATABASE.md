# Database Schema & Management

Complete guide to the SQLite database structure and student data management.

## Database File
- **Location**: `Examination/examination.db`
- **Type**: SQLite 3
- **Contains**: All exam papers, student accounts, attempts, answers, results, and scores

## Key Tables

### users
Student and teacher accounts with roles and authentication.

### exams
Exam papers with status (DRAFT → PUBLISHED → SCHEDULED → LIVE → CLOSED → RESULT_RELEASED).

### questions
Questions organized by section (PHYSICS, CHEMISTRY, etc.) with text and media.

### options
MCQ options (A, B, C, D) with correct answer flags.

### question_media
Images, PDFs, or diagrams for questions.

### attempts
Student exam attempts with start/end times and submission status.

### responses
Each student's answer to each question (selected option or integer value).

### results
Calculated scores, released status, and timestamps.

## Common Management Tasks

### Backup database
```bash
cp Examination/examination.db examination_backup_$(date +%s).db
```

### Check exam and attempt counts
```bash
sqlite3 Examination/examination.db "SELECT COUNT(*) FROM exams; SELECT COUNT(*) FROM attempts;"
```

### View student results
```bash
sqlite3 Examination/examination.db \
  "SELECT u.name, e.title, r.score FROM results r 
   JOIN attempts a ON r.attempt_id = a.id 
   JOIN users u ON a.student_id = u.id 
   JOIN exams e ON a.exam_id = e.id LIMIT 10;"
```

### Reset student attempt (let them re-attempt)
```bash
# Delete all answers and results for student 123 on exam 5
sqlite3 Examination/examination.db \
  "DELETE FROM responses WHERE attempt_id IN 
   (SELECT id FROM attempts WHERE student_id=123 AND exam_id=5); 
   DELETE FROM results WHERE attempt_id IN 
   (SELECT id FROM attempts WHERE student_id=123 AND exam_id=5); 
   DELETE FROM attempts WHERE student_id=123 AND exam_id=5;"
```

### Export results to CSV
```bash
sqlite3 -header -csv Examination/examination.db \
  "SELECT u.name, e.title, r.score, r.total_marks FROM results r 
   JOIN attempts a ON r.attempt_id = a.id 
   JOIN users u ON a.student_id = u.id 
   JOIN exams e ON a.exam_id = e.id;" > results.csv
```

## Restore from Backup
```bash
# Stop backend
pm2 stop exam-server

# Replace database
cp examination_backup_TIMESTAMP.db Examination/examination.db

# Restart
pm2 restart exam-server
```

For detailed schema and queries, see comments in Examination/src/schema/ files.
