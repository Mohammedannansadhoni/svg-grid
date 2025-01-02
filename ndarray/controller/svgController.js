const fs = require('fs');
const path = require('path');
const ndarray = require('ndarray');

const filePath = path.join('schema.json');

const readSchemaData = () => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading the file:', error);
        return null;
    }
};

const createSubregion = (x, startRow, endRow, startColumn, endColumn) => {
    for (let i = startRow; i >= endRow; --i) {
        for (let j = startColumn; j >= endColumn; --j) {
            x.set(i % x.shape[0], j % x.shape[1], 1); // Use modulo to ensure coordinates stay within bounds
        }
    }
    return x;
};

const rect = (screenWidth, screenHeight) => {
    const x = ndarray(new Float32Array(screenWidth * screenHeight), [screenHeight, screenWidth]);

    const subregions = [
        { startRow: 27, endRow: 20, startColumn: 29, endColumn: 20 },
        { startRow: 27, endRow: 20, startColumn: 59, endColumn: 50 },
        { startRow: 27, endRow: 20, startColumn: 89, endColumn: 80 },
        { startRow: 27, endRow: 20, startColumn: 119, endColumn: 110 },
        { startRow: 27, endRow: 20, startColumn: 149, endColumn: 140 },
        { startRow: 27, endRow: 20, startColumn: 179, endColumn: 170 },
        { startRow: 57, endRow: 50, startColumn: 39, endColumn: 30 },
        { startRow: 57, endRow: 50, startColumn: 69, endColumn: 60 },
        { startRow: 57, endRow: 50, startColumn: 99, endColumn: 90 },
        { startRow: 57, endRow: 50, startColumn: 129, endColumn: 120 },
        { startRow: 57, endRow: 50, startColumn: 159, endColumn: 150 },
        { startRow: 57, endRow: 50, startColumn: 189, endColumn: 180 },
        { startRow: 87, endRow: 80, startColumn: 29, endColumn: 20 },
        { startRow: 87, endRow: 80, startColumn: 59, endColumn: 50 },
        { startRow: 87, endRow: 80, startColumn: 89, endColumn: 80 },
        { startRow: 87, endRow: 80, startColumn: 119, endColumn: 110 },
        { startRow: 87, endRow: 80, startColumn: 149, endColumn: 140 },
        { startRow: 87, endRow: 80, startColumn: 179, endColumn: 170 },
        { startRow: 117, endRow: 110, startColumn: 39, endColumn: 30 },
        { startRow: 117, endRow: 110, startColumn: 69, endColumn: 60 },
        { startRow: 117, endRow: 110, startColumn: 99, endColumn: 90 },
        { startRow: 117, endRow: 110, startColumn: 129, endColumn: 120 },
        { startRow: 117, endRow: 110, startColumn: 159, endColumn: 150 },
        { startRow: 117, endRow: 110, startColumn: 189, endColumn: 180 },
    ];

    subregions.forEach(subregion => {
        createSubregion(x, subregion.startRow, subregion.endRow, subregion.startColumn, subregion.endColumn);
    });
    
    console.log(screenWidth, screenHeight);
    return x;
};

module.exports = { rect, readSchemaData };
