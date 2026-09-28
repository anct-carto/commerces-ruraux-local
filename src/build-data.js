// build-data.js
//
// Génère un fichier GeoJSON statique à partir de données 100% locales :
//   - data/FSCR.csv          (export du suivi des demandes)
//   - data/geom_ctr.geojson  (géométries des communes)
//
// Plus besoin de Grist, plus besoin de clé API, plus besoin d'un serveur
// Node qui tourne en continu : ce script s'exécute une fois, à la main,
// et écrit le résultat dans data/commerces-ruraux-geo.json.
//
// Utilisation :
//   1. Mets à jour data/FSCR.csv
//   2. Lance : node build-data.js
//   3. Dépose data/commerces-ruraux-geo.json (avec le reste du site) sur
//      ton serveur FTP. Pas de partie serveur à démarrer.

const fs = require("fs");
const path = require("path");

// -----------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------

// build-data.js est dans src/, data/ est au même niveau que src/ à la
// racine du projet (comme dans server.js).
const CSV_INPUT_PATH = path.join(__dirname, "..", "data", "FSCR.csv");
const GEOJSON_INPUT_PATH = path.join(__dirname, "..", "data", "geom_ctr.geojson");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "commerces-ruraux-geo.json");

// Nom de la colonne code commune dans le CSV, et de la propriété
// correspondante dans le GeoJSON des communes.
// ⚠️ À vérifier : adapte ces deux valeurs si tes en-têtes diffèrent.
const CSV_CODE_COLUMN = "Code commune";
const GEOJSON_CODE_PROPERTY = "insee_com";

// -----------------------------------------------------------------------
// PARSING CSV (gère les champs entre guillemets et les virgules internes)
// -----------------------------------------------------------------------

function parseCsv(csvText) {
  const rows = [];
  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return rows;

  const parseLine = (line) => {
    const values = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  };

  const headers = parseLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeCode(code) {
  if (code === null || code === undefined) return "";
  return String(code).trim();
}

// -----------------------------------------------------------------------
// JOINTURE CSV <-> GEOJSON
// -----------------------------------------------------------------------

function buildJoinedGeojson(csvRows, geojson) {
  const geomByCode = new Map();
  for (const feature of geojson.features) {
    const code = normalizeCode(feature.properties[GEOJSON_CODE_PROPERTY]);
    geomByCode.set(code, feature);
  }

  const features = [];
  const nonTrouves = [];

  for (const row of csvRows) {
    const code = normalizeCode(row[CSV_CODE_COLUMN]);
    const match = geomByCode.get(code);

    if (!match) {
      nonTrouves.push(code);
      continue;
    }

    features.push({
      type: "Feature",
      geometry: match.geometry,
      properties: {
        ...row,
        insee_com: code,
        libgeo: match.properties.libgeo || row["Ville"] || "",
      },
    });
  }

  if (nonTrouves.length > 0) {
    console.warn(
      `${nonTrouves.length} ligne(s) sans géométrie correspondante :`,
      nonTrouves.slice(0, 10)
    );
  }

  return {
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    features,
  };
}

// -----------------------------------------------------------------------
// EXÉCUTION
// -----------------------------------------------------------------------

try {
  const csvText = fs.readFileSync(CSV_INPUT_PATH, "utf-8");
  const csvRows = parseCsv(csvText);

  const geojson = JSON.parse(fs.readFileSync(GEOJSON_INPUT_PATH, "utf-8"));

  const joined = buildJoinedGeojson(csvRows, geojson);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(joined, null, 2), "utf-8");

  console.log(
    `Fichier généré : ${OUTPUT_PATH} (${joined.features.length} communes)`
  );
} catch (err) {
  console.error("Erreur lors de la génération du fichier :", err.message);
  process.exit(1);
}