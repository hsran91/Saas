const mongoose = require('mongoose');
const Medication = require('../models/Medication');
const Resident = require('../models/Resident');

const MONGO = process.env.MONGO || 'mongodb://127.0.0.1:27017/emar';

async function seed() {
  await mongoose.connect(MONGO);
  console.log('Connected to Mongo');

  const residents = await Resident.find().limit(5);
  if (!residents.length) {
    console.log('No residents found to seed. Create residents first.');
    process.exit(0);
  }

  const sampleMeds = [
    { name: 'Lisinopril', dosage: '10mg', route: 'PO', times: ['AM'] },
    { name: 'Metformin', dosage: '500mg', route: 'PO', times: ['AM','PM'] },
    { name: 'Zolpidem', dosage: '10mg', route: 'PO', times: ['NOC'] }
  ];

  let created = 0;
  for (const r of residents) {
    for (const m of sampleMeds) {
      const exists = await Medication.findOne({ residentId: r._id, name: m.name }).lean();
      if (exists) continue;
      await Medication.create({
        name: m.name,
        dosage: m.dosage,
        route: m.route,
        times: m.times,
        residentId: r._id
      });
      created++;
    }
  }

  console.log(`Seeded ${created} medications for ${residents.length} residents.`);
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
