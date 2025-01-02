const express = require("express");
const { rect, readSchemaData } = require("../controller/svgController");

const router = express.Router();

router.route('/rect').post((req, res) => {
    const { screenWidth, screenHeight } = req.body;
    const subregionData = rect(screenWidth, screenHeight);
    res.json(subregionData);
});

router.route('/schema').get((req, res) => {
    const schemaData = readSchemaData();
    res.json(schemaData);
});

module.exports = router;
