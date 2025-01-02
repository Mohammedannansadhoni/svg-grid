const express = require("express");
const bodyParser = require('body-parser');
const svgRoute = require("./routes/svgRoute");
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5001;

// Define readSchemaData function here
const readSchemaData = require("./controller/svgController").readSchemaData;

app.use(cors());
app.use(bodyParser.json());
app.use("/api/svg", svgRoute);

// Define route handler after readSchemaData function is defined
app.get('/schema', (req, res) => {
    const schemaData = readSchemaData();
    res.json(schemaData);
});

app.listen(port, () => {
    console.log(`Server started on ${port}`);
});
