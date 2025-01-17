const express = require('express');
const fs = require('fs');
const app = express();
const port = 3000;

// Middleware to enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Allow all origins
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/data', (req, res) => {
  fs.readFile('schema.json', 'utf8', (err, data) => {
    if (err) {
      res.status(500).send('Error reading schema.json');
    } else {
      res.json(JSON.parse(data));
    }
  });
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
