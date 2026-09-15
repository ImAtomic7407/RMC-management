/**
 * simulate_paper_assignment.js
 *
 * Standalone, zero-dependency simulation of the question-paper assignment
 * algorithm extracted from src/modules/exam-gate/assigned-paper.ts.
 *
 * Scenario:
 *   - 120 questions across 3 sections (PHYSICS, CHEMISTRY, MATHS) — 40 each
 *   - Each student is delivered 30 questions per section (90 total)
 *   - Selection strategy: ROTATED_SUBSET   (prime-step window rotation)
 *   - Order strategy:     ROTATED_SHUFFLED (Fisher-Yates seeded shuffle)
 *   - Anti-collision perturbation: up to 5 candidates, pick lowest collision
 *   - Simulate 100 students
 *
 * Checks performed (ground-truth assertions):
 *   1. Every student receives exactly 30 questions per section (90 total)
 *   2. No duplicate questions within a student's paper
 *   3. Every question delivered belongs to the correct section
 *   4. student_question_order is a gapless 1..90 sequence
 *   5. section_question_order is a gapless 1..30 sequence per section
 *   6. Section coverage: each question appears in AT LEAST 1 paper (no orphans)
 *   7. Section coverage: each question appears in AT MOST ~80% of papers (anti-monopoly)
 *   8. Position-collision rate stays below threshold (12%) for adjacent students
 *   9. Different students get different orderings (uniqueness of variant_seed)
 *  10. seededRandom is deterministic — same seed always gives same paper
 *  11. Prime-step rotation guarantees full coverage across enough students
 */

'use strict';

const crypto = require('crypto');

// ─── Algorithm verbatim copy from assigned-paper.ts ──────────────────────────

const VARIANT_SALT = 'examination-assigned-paper-v1';

function hashText(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function seededRandom(seed) {
  let state = parseInt(hashText(seed).slice(0, 8), 16) || 0x12345678;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic(items, seed) {
  const output = [...items];
  const random = seededRandom(seed);
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function rotateArray(items, offset) {
  if (items.length === 0) return [];
  const n = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function selectionStepForPool(poolSize) {
  if (poolSize <= 2) return 1;
  let candidate = Math.floor(poolSize / 2) + 1;
  while (candidate < poolSize) {
    if (isPrime(candidate) && poolSize % candidate !== 0) return candidate;
    candidate++;
  }
  candidate = poolSize - 1;
  while (candidate > 1) {
    if (isPrime(candidate) && poolSize % candidate !== 0) return candidate;
    candidate--;
  }
  return 1;
}

function deriveVariantSeed(examId, studentId, gateSessionId, assignedStudentNumber, versionId) {
  return hashText([examId, studentId, gateSessionId, assignedStudentNumber, versionId, VARIANT_SALT].join(':'));
}

function computePositionCollisionRate(candidate, neighbor) {
  if (!candidate.length || !neighbor.length) return 0;
  const neighborPos = new Map();
  for (const q of neighbor) neighborPos.set(q.version_question_id, q.student_question_order);
  let collisions = 0;
  for (const q of candidate) {
    if (neighborPos.get(q.version_question_id) === q.student_question_order) collisions++;
  }
  return collisions / Math.max(candidate.length, neighbor.length);
}

function buildSectionOrdering(questionsInSection, deliverCount, assignedStudentNumber, variantSeed, sectionCode, orderStrategy, perturbation) {
  const available = questionsInSection.length;
  let chosen;
  if (deliverCount >= available) {
    chosen = [...questionsInSection];
  } else {
    const stepSize = selectionStepForPool(available);
    const offset = (assignedStudentNumber * stepSize) % available;
    chosen = rotateArray(questionsInSection, offset).slice(0, deliverCount);
  }
  if (orderStrategy === 'ORIGINAL') return [...chosen].sort((a, b) => a.question_order - b.question_order);
  const shuffleSeed = perturbation === 0 ? `${variantSeed}:${sectionCode}` : hashText(`${variantSeed}:${sectionCode}:p${perturbation}`);
  return shuffleDeterministic(chosen, shuffleSeed);
}

// ─── Simulation Setup ─────────────────────────────────────────────────────────

const EXAM_ID = 1;
const VERSION_ID = 1;
const N_STUDENTS = 100;
const QUESTIONS_PER_SECTION = 40;
const DELIVER_PER_SECTION = 30;
const SECTIONS = ['PHYSICS', 'CHEMISTRY', 'MATHS'];

// Build mock question pool: 120 questions, ids 1..120
const allQuestions = [];
SECTIONS.forEach((section, si) => {
  for (let qi = 1; qi <= QUESTIONS_PER_SECTION; qi++) {
    allQuestions.push({
      id: si * QUESTIONS_PER_SECTION + qi,  // 1..120
      section_code: section,
      question_order: qi,
      question_type: qi % 5 === 0 ? 'INTEGER' : 'MCQ',
      question_text: `${section} Q${qi}`,
    });
  }
});

const sectionRules = SECTIONS.map(section => ({
  section: { section_code: section, section_order: SECTIONS.indexOf(section) + 1, question_count_target: DELIVER_PER_SECTION },
  questionsToDeliver: DELIVER_PER_SECTION,
  selectionStrategy: 'ROTATED_SUBSET',
  orderStrategy: 'ROTATED_SHUFFLED',
}));

// ─── Run simulation ───────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════════');
console.log('   QUESTION PAPER ASSIGNMENT ALGORITHM — SIMULATION REPORT');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`  Pool: ${allQuestions.length} questions (${QUESTIONS_PER_SECTION} per section × ${SECTIONS.length} sections)`);
console.log(`  Deliver: ${DELIVER_PER_SECTION} per section → ${DELIVER_PER_SECTION * SECTIONS.length} per student`);
console.log(`  Students: ${N_STUDENTS}`);
console.log('───────────────────────────────────────────────────────────────────\n');

const MAX_PERTURBATION = 5;
const COLLISION_THRESHOLD = 0.12;
const NEIGHBOR_CHECK_COUNT = 5;

const studentPapers = []; // array of { studentNumber, variantSeed, questions: [...] }

for (let s = 1; s <= N_STUDENTS; s++) {
  const studentId = 1000 + s;
  const gateSessionId = 2000 + s;
  const assignedStudentNumber = s;
  const variantSeed = deriveVariantSeed(EXAM_ID, studentId, gateSessionId, assignedStudentNumber, VERSION_ID);

  // Get neighbor positions (last NEIGHBOR_CHECK_COUNT papers)
  const neighborPositions = studentPapers.slice(Math.max(0, s - 1 - NEIGHBOR_CHECK_COUNT), s - 1)
    .map(p => p.questions.map(q => ({ version_question_id: q.version_question_id, student_question_order: q.studentQuestionOrder })));

  let bestQuestions = null;
  let bestMaxCollision = 2.0;
  let usedPerturbation = 0;

  for (let perturbation = 0; perturbation <= MAX_PERTURBATION; perturbation++) {
    const candidateQuestions = [];

    for (const sectionRule of sectionRules) {
      const questionsInSection = allQuestions.filter(q => q.section_code === sectionRule.section.section_code);
      const available = questionsInSection.length;
      const deliverCount = Math.min(sectionRule.questionsToDeliver, available);
      if (!available || !deliverCount) continue;

      const ordered = buildSectionOrdering(
        questionsInSection, deliverCount, assignedStudentNumber,
        variantSeed, sectionRule.section.section_code,
        sectionRule.orderStrategy, perturbation
      );

      ordered.forEach((q, index) => {
        candidateQuestions.push({
          version_question_id: q.id,
          section_code: q.section_code,
          original_question_order: q.question_order,
          sectionQuestionOrder: index + 1,
          studentQuestionOrder: candidateQuestions.length + 1,
        });
      });
    }

    const candidatePositions = candidateQuestions.map(q => ({
      version_question_id: q.version_question_id,
      student_question_order: q.studentQuestionOrder,
    }));
    const collisionRates = neighborPositions.map(n => computePositionCollisionRate(candidatePositions, n));
    const maxCollision = collisionRates.length > 0 ? Math.max(...collisionRates) : 0;

    if (maxCollision < bestMaxCollision) {
      bestMaxCollision = maxCollision;
      bestQuestions = candidateQuestions;
      usedPerturbation = perturbation;
    }
    if (maxCollision <= COLLISION_THRESHOLD) break;
  }

  studentPapers.push({ studentNumber: assignedStudentNumber, studentId, variantSeed, questions: bestQuestions, maxCollision: bestMaxCollision, usedPerturbation });
}

// ─── Ground-truth assertions ──────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

function assert(name, condition, detail = '') {
  if (condition) {
    pass++;
    process.stdout.write(`  ✅ PASS  ${name}\n`);
  } else {
    fail++;
    failures.push({ name, detail });
    process.stdout.write(`  ❌ FAIL  ${name}${detail ? ' — ' + detail : ''}\n`);
  }
}

console.log('─── CHECK 1: Every student gets exactly 30 questions per section ───');
let check1_ok = true;
const sectionCountViolations = [];
for (const paper of studentPapers) {
  for (const section of SECTIONS) {
    const count = paper.questions.filter(q => q.section_code === section).length;
    if (count !== DELIVER_PER_SECTION) {
      check1_ok = false;
      sectionCountViolations.push(`Student#${paper.studentNumber} ${section}: got ${count}, expected ${DELIVER_PER_SECTION}`);
    }
  }
}
assert('All 100 students × 3 sections = 30 questions each', check1_ok,
  check1_ok ? '' : sectionCountViolations.slice(0, 3).join('; '));

console.log('\n─── CHECK 2: Total questions per student = 90 ──────────────────────');
const totalViolations = studentPapers.filter(p => p.questions.length !== DELIVER_PER_SECTION * SECTIONS.length);
assert('Every student has exactly 90 questions total', totalViolations.length === 0,
  totalViolations.length ? `Student#${totalViolations[0].studentNumber} has ${totalViolations[0].questions.length}` : '');

console.log('\n─── CHECK 3: No duplicate questions in a paper ──────────────────────');
let check3_ok = true;
const dupViolations = [];
for (const paper of studentPapers) {
  const seen = new Set();
  for (const q of paper.questions) {
    if (seen.has(q.version_question_id)) {
      check3_ok = false;
      dupViolations.push(`Student#${paper.studentNumber} duplicate qid=${q.version_question_id}`);
    }
    seen.add(q.version_question_id);
  }
}
assert('No duplicate question IDs within any student paper', check3_ok,
  dupViolations.slice(0, 3).join('; '));

console.log('\n─── CHECK 4: Each question belongs to its declared section ──────────');
const sectionMap = new Map(allQuestions.map(q => [q.id, q.section_code]));
let check4_ok = true;
const secViolations = [];
for (const paper of studentPapers) {
  for (const q of paper.questions) {
    if (sectionMap.get(q.version_question_id) !== q.section_code) {
      check4_ok = false;
      secViolations.push(`Student#${paper.studentNumber} qid=${q.version_question_id} in wrong section`);
    }
  }
}
assert('All question section_codes are correct', check4_ok, secViolations.slice(0, 3).join('; '));

console.log('\n─── CHECK 5: student_question_order is gapless 1..90 ────────────────');
let check5_ok = true;
for (const paper of studentPapers) {
  const orders = paper.questions.map(q => q.studentQuestionOrder).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) { check5_ok = false; break; }
  }
}
assert('student_question_order is gapless [1..90] for all students', check5_ok);

console.log('\n─── CHECK 6: section_question_order is gapless 1..30 per section ────');
let check6_ok = true;
for (const paper of studentPapers) {
  for (const section of SECTIONS) {
    const orders = paper.questions.filter(q => q.section_code === section)
      .map(q => q.sectionQuestionOrder).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i + 1) { check6_ok = false; break; }
    }
  }
}
assert('section_question_order is gapless [1..30] for all sections/students', check6_ok);

console.log('\n─── CHECK 7: Every question appears in at least 1 paper ─────────────');
const questionAppearanceCount = new Map(allQuestions.map(q => [q.id, 0]));
for (const paper of studentPapers) {
  for (const q of paper.questions) {
    questionAppearanceCount.set(q.version_question_id, (questionAppearanceCount.get(q.version_question_id) || 0) + 1);
  }
}
const orphanQuestions = [...questionAppearanceCount.entries()].filter(([, c]) => c === 0);
assert(`No orphan questions (all ${allQuestions.length} questions appear at least once)`, orphanQuestions.length === 0,
  orphanQuestions.length ? `${orphanQuestions.length} orphans: qids ${orphanQuestions.slice(0, 5).map(([id]) => id).join(',')}` : '');

console.log('\n─── CHECK 8: Coverage spread — no question in >80% of papers ────────');
const maxAppearance = Math.max(...questionAppearanceCount.values());
const maxAppearancePct = (maxAppearance / N_STUDENTS * 100).toFixed(1);
const monopolyQuestions = [...questionAppearanceCount.entries()].filter(([, c]) => c > N_STUDENTS * 0.8);
assert('No question appears in >80% of papers (anti-monopoly)', monopolyQuestions.length === 0,
  monopolyQuestions.length ? `${monopolyQuestions.length} monopoly questions, max=${maxAppearancePct}%` : `max=${maxAppearancePct}%`);

console.log('\n─── CHECK 9: All 100 variant seeds are unique ───────────────────────');
const seeds = new Set(studentPapers.map(p => p.variantSeed));
assert('All 100 students have unique variant seeds', seeds.size === N_STUDENTS,
  seeds.size !== N_STUDENTS ? `Only ${seeds.size} unique seeds` : '');

console.log('\n─── CHECK 10: Determinism — same seed → same paper ──────────────────');
// Re-generate paper for student #42 and compare
const target = studentPapers[41]; // studentNumber=42
const regenSeed = target.variantSeed;
const regenQuestions = [];
for (const sectionRule of sectionRules) {
  const questionsInSection = allQuestions.filter(q => q.section_code === sectionRule.section.section_code);
  const ordered = buildSectionOrdering(questionsInSection, DELIVER_PER_SECTION, target.studentNumber, regenSeed, sectionRule.section.section_code, 'ROTATED_SHUFFLED', 0);
  ordered.forEach((q, i) => regenQuestions.push({ id: q.id, sqo: regenQuestions.length + 1 }));
}
const originalIds = target.questions.map(q => q.version_question_id).join(',');
const regenIds = regenQuestions.map(q => q.id).join(',');
assert('Same seed always produces same paper (determinism)', originalIds === regenIds);

console.log('\n─── CHECK 11: Position-collision rate stays below threshold ─────────');
const collisionRates = studentPapers.slice(1).map(p => p.maxCollision).filter(r => r < 2.0);
const avgCollision = collisionRates.reduce((a, b) => a + b, 0) / collisionRates.length;
const maxCollisionOverall = Math.max(...collisionRates);
const aboveThreshold = studentPapers.filter(p => p.maxCollision > COLLISION_THRESHOLD && p.maxCollision < 2.0).length;
assert(`Max collision rate ≤ ${(COLLISION_THRESHOLD * 100).toFixed(0)}% for all students`, aboveThreshold === 0,
  aboveThreshold ? `${aboveThreshold} students exceeded threshold` : `avg=${(avgCollision * 100).toFixed(2)}%, max=${(maxCollisionOverall * 100).toFixed(2)}%`);

console.log('\n─── CHECK 12: Prime-step guarantees full rotation coverage ──────────');
// With pool=40, deliver=30, step=selectionStepForPool(40)
// After 40 students the window should have visited every start offset 0..39
const poolSize = QUESTIONS_PER_SECTION;
const step = selectionStepForPool(poolSize);
const visitedOffsets = new Set();
for (let sn = 1; sn <= poolSize; sn++) visitedOffsets.add((sn * step) % poolSize);
assert(`Prime step (step=${step}) for pool=${poolSize} visits all ${poolSize} offsets after ${poolSize} students`, visitedOffsets.size === poolSize,
  visitedOffsets.size !== poolSize ? `Only ${visitedOffsets.size} unique offsets` : '');

// ─── Distribution stats ───────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('   DISTRIBUTION STATISTICS');
console.log('═══════════════════════════════════════════════════════════════════');

for (const section of SECTIONS) {
  const sectionQ = allQuestions.filter(q => q.section_code === section);
  const counts = sectionQ.map(q => questionAppearanceCount.get(q.id) || 0);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const avg = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
  const stddev = Math.sqrt(counts.reduce((acc, c) => acc + Math.pow(c - parseFloat(avg), 2), 0) / counts.length).toFixed(2);
  console.log(`  ${section.padEnd(10)}: appearances min=${min} max=${max} avg=${avg} stddev=${stddev} per question (out of ${N_STUDENTS} students)`);
}

console.log('\n  Perturbation usage:');
const perturbUsage = [0, 0, 0, 0, 0, 0];
studentPapers.forEach(p => perturbUsage[p.usedPerturbation]++);
perturbUsage.forEach((c, i) => { if (c) console.log(`    perturbation=${i}: ${c} students`); });

console.log('\n  Collision rates (against last 5 neighbors):');
console.log(`    Average: ${(avgCollision * 100).toFixed(3)}%`);
console.log(`    Maximum: ${(maxCollisionOverall * 100).toFixed(3)}%`);
console.log(`    Threshold: ${(COLLISION_THRESHOLD * 100).toFixed(0)}%`);

// ─── Sample paper printout (student #1 and #2 to show they differ) ───────────
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('   SAMPLE PAPERS (Student #1 vs Student #2)');
console.log('═══════════════════════════════════════════════════════════════════');
for (const sn of [1, 2]) {
  const paper = studentPapers[sn - 1];
  console.log(`\n  Student #${paper.studentNumber}  seed=${paper.variantSeed.slice(0, 16)}...`);
  for (const section of SECTIONS) {
    const qs = paper.questions.filter(q => q.section_code === section).map(q => q.version_question_id);
    console.log(`    ${section}: [${qs.join(', ')}]`);
  }
}

// ─── Final verdict ────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`   RESULT: ${pass} PASSED  |  ${fail} FAILED`);
if (fail > 0) {
  console.log('\n   FAILURES:');
  failures.forEach(f => console.log(`     ❌ ${f.name}: ${f.detail}`));
}
console.log('═══════════════════════════════════════════════════════════════════\n');

process.exit(fail > 0 ? 1 : 0);
