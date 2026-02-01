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

// Create output folder if it doesn't exist
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

// Main async function
async function processImages() {
  // Get all image files from input folder
  const files = fs
    .readdirSync(inputFolder)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));

  if (files.length === 0) {
    console.log("No images found in input folder!");
    return;
  }

  // Process each image
  for (const file of files) {
    const inputPath = path.join(inputFolder, file);
    const baseName = path.parse(file).name;

    console.log(`Processing ${file}...`);

    for (const size of sizes) {
      // Generate PNG
      await sharp(inputPath)
        .resize(size)
        .png({ quality: 90 })
        .toFile(path.join(outputFolder, `${baseName}-${size}.png`));

      // Generate WebP
      await sharp(inputPath)
        .resize(size)
        .webp({ quality: 85 })
        .toFile(path.join(outputFolder, `${baseName}-${size}.webp`));
    }

    console.log(`✓ ${file} done!`);
  }

  console.log("\nAll images processed!");
  console.log("\nGenerated sizes:", sizes.join(", "));
}

// Run it
processImages().catch((err) => console.error("Error:", err));
