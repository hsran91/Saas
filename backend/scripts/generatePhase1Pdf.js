const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const rootDir = path.resolve(__dirname, "..", "..");
const markdownPath = path.join(rootDir, "docs", "phase1-report.md");
const outPath = path.join(rootDir, "docs", "Phase1-Implementation-Report.pdf");

if (!fs.existsSync(markdownPath)) {
  throw new Error(`Missing report source: ${markdownPath}`);
}

const content = fs.readFileSync(markdownPath, "utf8");

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 50, bottom: 50, left: 50, right: 50 }
});

const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

doc.font("Helvetica-Bold").fontSize(16).text("eMAR SaaS Hardening - Phase 1 Implementation Report", { align: "left" });
doc.moveDown(0.8);

doc.font("Helvetica").fontSize(10);
const lines = content.split(/\r?\n/);

for (const rawLine of lines) {
  const line = rawLine.trimEnd();

  if (!line) {
    doc.moveDown(0.45);
    continue;
  }

  if (line.startsWith("# ")) {
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(14).text(line.replace(/^#\s+/, ""));
    doc.font("Helvetica").fontSize(10);
    continue;
  }

  if (line.startsWith("## ")) {
    doc.moveDown(0.35);
    doc.font("Helvetica-Bold").fontSize(12).text(line.replace(/^##\s+/, ""));
    doc.font("Helvetica").fontSize(10);
    continue;
  }

  if (line.startsWith("### ")) {
    doc.moveDown(0.25);
    doc.font("Helvetica-Bold").fontSize(11).text(line.replace(/^###\s+/, ""));
    doc.font("Helvetica").fontSize(10);
    continue;
  }

  if (line.startsWith("- ")) {
    doc.text(`- ${line.slice(2)}`, { indent: 14 });
    continue;
  }

  if (/^\d+\.\s+/.test(line)) {
    doc.text(line, { indent: 10 });
    continue;
  }

  doc.text(line);
}

doc.end();

stream.on("finish", () => {
  // eslint-disable-next-line no-console
  console.log(`PDF generated: ${outPath}`);
});
