const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Configuration
const inputFolder = "./input";
const outputFolder = "../assets/image/generated/";

// Sizes based on common device widths
// Mobile: 100vw - 24px → targeting ~350-750px range
// Desktop: (50vw - 32px) * 1.25 parallax → targeting ~600-1700px range
// We'll generate sizes to cover these ranges efficiently
const sizes = [
  326, // Small mobile (350 - 24)
  476, // Medium mobile (500 - 24)
  726, // Large mobile (750 - 24)
  780, // Small desktop ((1280 * 0.5 - 32) * 1.25)
  985, // Medium desktop ((1600 * 0.5 - 32) * 1.25)
  1210, // Large desktop ((2000 * 0.5 - 32) * 1.25)
  1710, // XL desktop ((2800 * 0.5 - 32) * 1.25)
];

const inputExtRegex = /\.(png|jpg|jpeg|webp)$/i;
const generatedFileRegex = /^(.+)-(\d+)\.webp$/i;

// Create output folder if it doesn't exist
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

// Remove generated files whose source image is no longer in the input folder
function cleanOrphans(inputBaseNames) {
  if (!fs.existsSync(outputFolder)) {
    return;
  }
  const sizesSet = new Set(sizes);
  let removed = 0;

  for (const file of fs.readdirSync(outputFolder)) {
    const match = file.match(generatedFileRegex);
    if (!match) {
      continue;
    }
    const baseName = match[1];
    const size = Number(match[2]);
    if (!sizesSet.has(size)) {
      continue;
    }
    if (inputBaseNames.has(baseName)) {
      continue;
    }

    fs.unlinkSync(path.join(outputFolder, file));
    console.log(`✗ Removed orphan: ${file}`);
    removed++;
  }

  if (removed > 0) {
    console.log(`\nCleaned up ${removed} orphan file(s).`);
  } else {
    console.log("\nNo orphans to clean.");
  }
}

// Main async function
async function processImages() {
  // Get all image files from input folder
  const files = fs.existsSync(inputFolder)
    ? fs.readdirSync(inputFolder).filter((file) => inputExtRegex.test(file))
    : [];

  const inputBaseNames = new Set(files.map((file) => path.parse(file).name));

  if (files.length === 0) {
    console.log("No images found in input folder.");
  } else {
    // Process each image
    for (const file of files) {
      const inputPath = path.join(inputFolder, file);
      const baseName = path.parse(file).name;

      console.log(`Processing ${file}...`);

      for (const size of sizes) {
        await sharp(inputPath)
          .resize(size)
          .webp({ quality: 85 })
          .toFile(path.join(outputFolder, `${baseName}-${size}.webp`));
      }

      console.log(`✓ ${file} done!`);
    }

    console.log("\nAll images processed!");
    console.log("Generated sizes:", sizes.join(", "));
  }

  cleanOrphans(inputBaseNames);
}

// Run it
processImages().catch((err) => console.error("Error:", err));
