import { importStudentRecord } from "../modules/identity/service";

type RosterEntry = {
  full_name: string;
  batch_names: string[];
};

const rawRoster = `Student\tBatch
ADITYA KUMAR\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Aavya Raj\t11th_Parth_TTS_6-8pm
Adarsh Raj\t12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8
Adarsh kumar gupta\t11th_Parth_TTS_6-8pm
Aman raj\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Amar Jyoti\t11th_Parth_TTS_6-8pm
Anjani Sharma\t12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30
Anjesh kumar\t11th_Parth_TTS_6-8pm
Ankit Raj\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Ankit raj\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Anmol Srivastava\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Anushka Yadav\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Ashish Kumar\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Ashutosh kumar\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Ayush Raj\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Ayush kumar\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Bhaskar sahay\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
DIVYANSHU RAJ\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Dhairya Ojha\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Diwakar kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Esha Kumari\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Gopal kumar\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Harsh\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Harsh Raj\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Himanshu\tDROPPERS
Hrishu Raj\t12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30
Kanhaiya Kumar\t11th_Parth_TTS_6-8pm
Karan kumar\t11th_Parth_TTS_6-8pm
Keshav kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Kishan Raj\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Krishna\tDROPPERS
Kriti Rani\t11th_Parth_TTS_6-8pm
Kunal mahato\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
MOLU KUMAR\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Nibha Gupta\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Nishant\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Nishant kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
PRITHVI RAJ\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Prince Kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Pritam kumar singh\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Priyanshu Raj\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Rajnandani\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Rajnish kumar\t11th_Parth_TTS_6-8pm
Rakesh Kumar\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Ram Krishna\t11th_Parth_TTS_6-8pm
Raushan Raj\t11th_Parth_TTS_6-8pm
Rimisha\t11th_Parth_TTS_6-8pm
Rishav Raj\t11th_Parth_TTS_6-8pm
Rishav Raman\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Ritesh\tDROPPERS
Ritik Raj\t11th_Parth_TTS_6-8pm
Riya sharma\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Rohit roy\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Rudra Vijayant\t12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30
SAKSHI KUMARI\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
SUMIT KUMAR\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Sachin Kumar\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Sahil Singh\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Sahil raj\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Saket Kumar Singh\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Saloni kumari\t11th_Parth_TTS_6-8pm
Saras kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Satyam Kumar\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Satyam Raj\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Satyam kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Shailesh ranjan\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Shidhant Kumar\t12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8
Shiv kumar\t12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30
Shivam kumar\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Sonali kumari\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Sudhanshu Kumar\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Sudhanshu Kumar\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Sunny Kumar\t12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm
Swarit krishna\t11th_Parth_TTS_6-8pm
Swati Kumari\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
Ujjawal kumar\t11th_Parth_TTS_6-8pm
Ushashi Srivastava\t11th_Parth_TTS_6-8pm
Utkarsh\t12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30, 12th_UDAAN_MWF_6-8
Utsav singh\t12th_UDAAN_MWF_6-8, 12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm
VAIBHAV VISHAL JHA\t12th_UDAAN_MWF_6-8, 12th_JEET_TTS_4-6 pm, 12th_JEE_TTS_6:30-8:30
Vishal Gupta\t11th_Parth_TTS_6-8pm
ayush raj\t12th_JEE_TTS_6:30-8:30, 12th_JEET_TTS_4-6 pm, 12th_UDAAN_MWF_6-8`;

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseRoster(raw: string): RosterEntry[] {
  const lines = raw.trim().split(/\r?\n/);
  const byName = new Map<string, RosterEntry>();
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [namePart, batchPart] = trimmed.split("\t");
    const full_name = (namePart ?? "").trim();
    const batches = (batchPart ?? "")
      .split(",")
      .map((batch) => batch.trim())
      .filter(Boolean);
    if (!full_name || batches.length === 0) continue;
    const existing = byName.get(full_name);
    if (existing) {
      existing.batch_names = Array.from(new Set([...existing.batch_names, ...batches]));
    } else {
      byName.set(full_name, {
        full_name,
        batch_names: Array.from(new Set(batches)),
      });
    }
  }
  return Array.from(byName.values());
}

async function main() {
  const roster = parseRoster(rawRoster);
  let created = 0;
  for (const entry of roster) {
    const studentUid = slugify(entry.full_name);
    const result = await importStudentRecord({
      source_system: "manual_roster",
      source_uid: `manual_roster:${studentUid}`,
      student_uid: studentUid,
      username: entry.full_name,
      full_name: entry.full_name,
      batch_name: entry.batch_names[0],
      batch_names: entry.batch_names,
      active: true,
    });
    created += 1;
    console.log(`[${created}/${roster.length}] ${result.full_name} -> ${result.username} | batches=${result.batch_names.join(", ")}`);
  }
  console.log(`Imported ${created} student roster records.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
