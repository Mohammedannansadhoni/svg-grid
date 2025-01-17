$(document).ready(function () {
    let schemename;
    let grid = []; // To store the state of each grid cell (0 or 1)
    let prevRectPosition = { x: null, y: null }; // Track previous position of the rectangle

    $.ajax({
        url: "http://localhost:3000/data",
        type: "GET",
        contentType: "application/json",
        success: function (response) {
            schemename = response;
            console.log('Schema Data:', schemename);

            const zeroContainer = $('#zero-container');
            const totalCols = Math.floor(window.innerWidth / 10);
            const totalRows = Math.floor(window.innerHeight / 10);

            // Initialize grid with 0's
            for (let row = 0; row < totalRows; row++) {
                grid[row] = [];
                for (let col = 0; col < totalCols; col++) {
                    grid[row].push(0); // Start with 0 (unmodified)
                }
            }

            // Set up the canvas
            const canvas = $('#canvas')[0];
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');

            const rectWidth = 100;
            const rectHeight = 100;
            let rectX = 50;
            let rectY = 50;

            function drawRect() {
                ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear previous rectangle
                ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
            }

            drawRect();

            let isDragging = false;
            let offsetX, offsetY;

            canvas.addEventListener('mousedown', function (event) {
                if (event.offsetX >= rectX && event.offsetX <= rectX + rectWidth &&
                    event.offsetY >= rectY && event.offsetY <= rectY + rectHeight) {
                    isDragging = true;
                    offsetX = event.offsetX - rectX;
                    offsetY = event.offsetY - rectY;
                }
            });

            canvas.addEventListener('mousemove', function (event) {
                if (isDragging) {
                    rectX = Math.floor((event.offsetX - offsetX) / 10) * 10;
                    rectY = Math.floor((event.offsetY - offsetY) / 10) * 10;
                    requestAnimationFrame(drawRect); // Optimize redraw with requestAnimationFrame
                }
            });

            canvas.addEventListener('mouseup', function () {
                if (isDragging) {
                    // Before updating the grid, reset the previous area to 0
                    if (prevRectPosition.x !== null && prevRectPosition.y !== null) {
                        const prevCol = Math.floor(prevRectPosition.x / 10);
                        const prevRow = Math.floor(prevRectPosition.y / 10);
                        for (let i = 0; i < rectHeight / 10; i++) {
                            for (let j = 0; j < rectWidth / 10; j++) {
                                if (prevRow + i < grid.length && prevCol + j < grid[0].length) {
                                    grid[prevRow + i][prevCol + j] = 0; // Reset the previous position to 0
                                }
                            }
                        }
                    }

                    const col = Math.floor(rectX / 10);
                    const row = Math.floor(rectY / 10);

                    // Update grid values where the rectangle is dropped
                    for (let i = 0; i < rectHeight / 10; i++) {
                        for (let j = 0; j < rectWidth / 10; j++) {
                            if (row + i < grid.length && col + j < grid[0].length) {
                                grid[row + i][col + j] = 1;
                            }
                        }
                    }

                    updateZeroContainer();

                    prevRectPosition.x = rectX;
                    prevRectPosition.y = rectY;

                    isDragging = false;
                }
            });

            canvas.addEventListener('mouseout', function () {
                isDragging = false;
            });

            // Function to update the zero container efficiently
            function updateZeroContainer() {
                // Use DocumentFragment to batch append changes to the DOM
                const fragment = document.createDocumentFragment();
                for (let row = 0; row < totalRows; row++) {
                    for (let col = 0; col < totalCols; col++) {
                        const zeroDiv = $('<div class="zero"></div>');
                        if (grid[row][col] === 1) {
                            zeroDiv.text('1');
                            zeroDiv.css('background-color', '#ff0');
                        } else {
                            zeroDiv.text('0');
                            zeroDiv.css('background-color', '#f0f0f0');
                        }
                        fragment.appendChild(zeroDiv[0]); // Append to the fragment
                    }
                }
                $('#zero-container').empty().append(fragment); // Append the fragment to the container
            }

        },
        error: function (error) {
            console.error('Error fetching data:', error);
            $('#zero-container').text('Failed to load data.');
        }
    });
});  