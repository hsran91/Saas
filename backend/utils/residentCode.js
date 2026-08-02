const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateResidentCode(length = 6) {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

async function getUniqueResidentCode(ResidentModel, tenantId, length = 6) {
  if (!tenantId) {
    throw new Error("tenantId is required for resident code generation");
  }

  let code;
  let existing;
  do {
    code = generateResidentCode(length);
    existing = await ResidentModel.findOne({ tenantId, residentCode: code }).lean();
  } while (existing);
  return code;
}

module.exports = { getUniqueResidentCode };
