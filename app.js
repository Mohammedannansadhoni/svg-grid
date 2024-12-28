const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

// Enable CORS 
app.use(cors());
app.use(express.json()); // To parse JSON bodies

// Serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to serve matrix.json
app.get('/matrix.json', (req, res) => {
  const filePath = path.join(__dirname, 'grid.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading file:', err);
      res.status(500).send('Error reading file');
      return;
    }
    res.json(JSON.parse(data));
  });
});

// Endpoint to update grid.json directly
app.put('/grid.json', (req, res) => {
  const updatedGrid = req.body;
  const filePath = path.join(__dirname, 'grid.json'); // Overwrite the same file

  fs.writeFile(filePath, JSON.stringify(updatedGrid, null, 2), (err) => {
    if (err) {
      console.error('Error writing file:', err);
      res.status(500).send('Error saving file');
      return;
    }
    res.send('Grid state updated successfully.');
  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
