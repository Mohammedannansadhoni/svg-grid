let resizing = false;
let originalData;
let mergeMap = new Map();
let isSVGLayoutCreated = false;
let mergedCellData = {}
let animationFrame = null;
const elementsMap = new Map();
let selectedCellId = null;
let globalWidth = 100; // Default width
let globalHeight = 100; // Default height
let hoveredCellId = null;
let resizingShape = null;
let initialMousePosition = null;
let initialShapeAttributes = null;
let selectedShape = null;
let contextMenu = null;
const history = [];
const redoStack = [];


// Fetch data from the server
$.ajax({
    url: "http://localhost:3000/matrix.json",
    type: "GET",
    contentType: "application/json",
    success: function (response) {
        originalData = response;
        createSVGLayout(response);
    },
});

function createSVGLayout(data) {
    const container = document.getElementById("svg-container");

    // Clear previous content
    container.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");

    let currentY = 0;
    const rowRects = [];

    const calculateDimensions = () => {
        const totalWidth = data.layout.table.row[0].column.reduce((sum, col) => sum + col.meta.width, 0);
        const totalHeight = data.layout.table.row.reduce((sum, row) => sum + row.meta.height, 0);
        return { totalWidth, totalHeight };
    };

    const { totalWidth, totalHeight } = calculateDimensions();

    // Set dynamic width and height for SVG
    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);

    data.layout.table.row.forEach((row, rowIndex) => {
        const rowHeight = row.meta.height;
        let currentX = 0;

        row.column.forEach((col, colIndex) => {
            const colWidth = col.meta.width;


            const colHeight = col.meta.height;

            // Create group for cell
            const rectGroup = document.createElementNS(svgNS, "g");
            rectGroup.setAttribute("class", "cell-group");

            // Add grid background
            const gridGroup = document.createElementNS(svgNS, "g");
            gridGroup.setAttribute("class", "grid-group");
            createBackgroundGrid(gridGroup, currentX, currentY, colWidth, colHeight);
            rectGroup.appendChild(gridGroup);

            // Create cell rectangle
            const cellId = `cell_${colIndex}_${rowIndex}`;
            const rect = document.createElementNS(svgNS, "rect");
            rect.setAttribute("x", currentX);
            rect.setAttribute("y", currentY);
            rect.setAttribute("width", colWidth);
            rect.setAttribute("height", colHeight);
            rect.setAttribute("class", "parent");
            rect.setAttribute("id", cellId);
            rect.setAttribute("fill", "none");

            // Check if this cell is part of a merged cell
            let isMerged = false;
            for (const [id, mergedCell] of Object.entries(mergedCellData)) {
                if (mergedCell.children.includes(cellId)) {
                    // This cell is part of a merged cell, hide it
                    rect.style.display = "none";
                    isMerged = true;
                    break;
                }
            }

            if (!isMerged) {
                rectGroup.appendChild(rect);
            }

            // Store reference for resizing/merging
            if (!rowRects[rowIndex]) rowRects[rowIndex] = [];
            rowRects[rowIndex].push(rect);

            svg.appendChild(rectGroup);

            // Apply resize logic
            resize(rect, rowRects, rowIndex, colIndex);

            currentX += colWidth;
        });

        currentY += rowHeight;

    });

    // Re-render existing merged cells with updated dimensions
    for (const [id, mergedCell] of Object.entries(mergedCellData)) {
        // Validate merged cell children
        const children = mergedCell.children.map((childId) =>
            rowRects.flat().find((rect) => rect.getAttribute("id") === childId)
        );

        if (children.some((child) => !child)) {
            console.warn(`Skipping regeneration of merged cell ${id} due to missing child cells`);
            continue; // Skip if any child cell is missing
        }

        // Recalculate merged cell dimensions
        const xs = children.map((rect) => parseFloat(rect.getAttribute("x")));
        const ys = children.map((rect) => parseFloat(rect.getAttribute("y")));
        const widths = children.map((rect) => parseFloat(rect.getAttribute("width")));
        const heights = children.map((rect) => parseFloat(rect.getAttribute("height")));

        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
        const maxY = Math.max(...ys.map((y, i) => y + heights[i]));

        mergedCell.x = minX;
        mergedCell.y = minY;
        mergedCell.width = maxX - minX;
        mergedCell.height = maxY - minY;

        // Create updated merged cell rectangle
        const newRect = document.createElementNS(svgNS, "rect");
        newRect.setAttribute("x", mergedCell.x);
        newRect.setAttribute("y", mergedCell.y);
        newRect.setAttribute("width", mergedCell.width);
        newRect.setAttribute("height", mergedCell.height);
        newRect.setAttribute("class", "parent merged");
        newRect.setAttribute("id", id);

        mergeMap.set(newRect, children);
        svg.appendChild(newRect);





        // Apply resize logic to merged cells
        resize(newRect, rowRects, -1, -1);

    }


    container.appendChild(svg);

    // Attach event listeners
    svg.addEventListener("dblclick", () => mergeSelectedCells(svg, rowRects));

    // Save the initial grid state
    saveGridState(rowRects);

    console.log("Merged Cell Data:", mergedCellData);
}

function createBackgroundGrid(group, startX, startY, colWidth, colHeight) {
    const svgNS = "http://www.w3.org/2000/svg";
    const cellWidth = 10;
    const cellHeight = 10;

    const numCols = Math.ceil(colWidth / cellWidth);
    const numRows = Math.ceil(colHeight / cellHeight);

    for (let x = 0; x < numCols; x++) {
        for (let y = 0; y < numRows; y++) {
            const gridRect = document.createElementNS(svgNS, "rect");
            gridRect.setAttribute("x", startX + x * cellWidth);
            gridRect.setAttribute("y", startY + y * cellHeight);
            gridRect.setAttribute("width", cellWidth);
            gridRect.setAttribute("height", cellHeight);
            gridRect.setAttribute("class", "grid-cell");
            gridRect.setAttribute("fill", "none");
            gridRect.setAttribute("stroke", "#ccc");
            gridRect.setAttribute("stroke-width", "0.1%");
            group.appendChild(gridRect);
        }
    }
}


function hoverOnCell(c) {
    c.addEventListener("mouseover", function (e) {
        // console.log(e.target.id);
        document.getElementById("hoverdCell").innerText = e.target.id;
    });
    
}

function resize(rect, rowRects, rowIndex, colIndex) {
    rect.addEventListener("mouseover", function (e) {
        if (!resizing) {
            setCursor(e, rect, rowIndex, rowRects[rowIndex], colIndex);
        }
    });

    rect.addEventListener("mouseout", function () {
        if (!resizing) {
            document.body.classList.remove("col-resize", "row-resize", "nw-resize");
        }
    });

    rect.addEventListener("mousedown", function (e) {
        handleMouseDown(e, rect, rowRects, rowIndex, colIndex);
    });

    rect.addEventListener("click", function (e) {
        if (e.detail === 3) {
            unmergeCell(rect, rowRects);
        }
    });

}

function setCursor(event, rect, rowIndex, columnRects, colIndex) {
    const { x, width, y, height } = rect.getBBox();
    const cursorBuffer = 10;

    document.body.classList.remove("col-resize", "row-resize", "nw-resize");

    if (event.clientX >= x + width - cursorBuffer && event.clientY >= y + height - cursorBuffer) {
        document.body.classList.add("nw-resize");
    } else if (event.clientX >= x + width - cursorBuffer) {
        document.body.classList.add("col-resize");
    } else if (event.clientY >= y + height - cursorBuffer) {
        document.body.classList.add("row-resize");
    }
}

function handleMouseDown(e, rect, rowRects, rowIndex, colIndex) {
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = parseFloat(rect.getAttribute("width"));
    const startHeight = parseFloat(rect.getAttribute("height"));
    const resizeDirection = getResizeDirection(e, rect);

    if (!resizeDirection) return;

    resizing = true;
    document.body.classList.add(resizeDirection);

    function onMouseMove(e) {
        let dx = e.clientX - startX;
        let dy = e.clientY - startY;

        dx = Math.round(dx / 10) * 10;
        dy = Math.round(dy / 10) * 10;

        if (resizeDirection.includes("col-resize")) {
            const newWidth = Math.max(startWidth + dx, 100);
            globalWidth = newWidth;
            updateColumnWidth(rect, newWidth, rowRects, rowIndex, colIndex);
            // Update global width
        }

        if (resizeDirection.includes("row-resize")) {
            const newHeight = Math.max(startHeight + dy, 100);
            updateRowHeight(rect, newHeight, rowRects, rowIndex);
            globalHeight = newHeight; // Update global height
        }

        updateMergedCellsThrottled(rowRects);
    }


    function onMouseUp() {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        resizing = false;
        document.body.classList.remove("col-resize", "row-resize", "nw-resize");

        // Save updated state
        saveGridState(rowRects);
    }


    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
}

function updateMergedCellsThrottled(rowRects) {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(() => {
        updateMergedCells(rowRects);
        animationFrame = null;
    });
}

function getResizeDirection(event, rect) {
    const rectBounds = rect.getBoundingClientRect();
    const cursorBuffer = 15; // Adjust as needed

    const { left, width, top, height } = rectBounds;

    if (event.clientX >= left + width - cursorBuffer && event.clientY >= top + height - cursorBuffer) {
        return "nw-resize";
    } else if (event.clientX >= left + width - cursorBuffer) {
        return "col-resize";
    } else if (event.clientY >= top + height - cursorBuffer) {
        return "row-resize";
    }
    return null;
}

function updateColumnWidth(rect, newWidth, rowRects, rowIndex, colIndex) {
    if (!Array.isArray(rowRects) || colIndex === 0) return;

    const originalWidth = parseFloat(rect.getAttribute("width"));
    const widthDiff = newWidth - originalWidth;

    const mergedCells = mergeMap.get(rect);
    if (mergedCells) {
        mergedCells.forEach(cell => {
            const cellColIndex = parseInt(cell.getAttribute('id').split('_')[1]);
            updateColumnWidth(cell, newWidth, rowRects, rowIndex, cellColIndex);
        });
        return;
    }

    originalData.layout.table.row.forEach(row => {
        row.column[colIndex].meta.width = newWidth;
    });


    // Update width of the resized cell
    rowRects.forEach(row => {
        if (row[colIndex]) {
            row[colIndex].setAttribute("width", newWidth);
            updateGrid(row[colIndex], newWidth, parseFloat(row[colIndex].getAttribute("height")));
            // Update text box or image dimensions
            const cellId = row[colIndex].getAttribute("id");
            const textBox = document.getElementById(`text_${cellId}`);
            const image = document.getElementById(`image_${cellId}`);

            if (textBox) {
                textBox.style.width = `${newWidth}px`;
            }
            if (image) {
                image.style.width = `${newWidth}px`;
            }
        }
    });

    // Adjust x position of subsequent cells
    for (let cIndex = colIndex + 1; cIndex < rowRects[rowIndex].length; cIndex++) {
        rowRects.forEach(row => {
            if (row[cIndex]) {
                const currentX = parseFloat(row[cIndex].getAttribute("x"));
                row[cIndex].setAttribute("x", currentX + widthDiff);
                updateGrid(row[cIndex], parseFloat(row[cIndex].getAttribute("width")), parseFloat(row[cIndex].getAttribute("height")));
            }
        });
    }

    // Recalculate and update SVG dimensions
    updateSvgDimensions();
    updateMergedCells(rowRects);
    saveGridState(rowRects);
    saveState();
}

function updateRowHeight(rect, newHeight, rowRects, rowIndex) {
    if (!Array.isArray(rowRects) || rowIndex === 0 || !rowRects[rowIndex]) return;

    const originalHeight = parseFloat(rect.getAttribute("height"));
    const heightDiff = newHeight - originalHeight;

    // Update the resized row's height in `originalData`
    const rowData = originalData.layout.table.row[rowIndex];
    rowData.meta.height = newHeight;

    // Update the height and meta of all cells in the resized row
    rowRects[rowIndex].forEach((rowRect, colIndex) => {
        const cellId = rowRect.getAttribute("id");
        const textBox = document.getElementById(`text_${cellId}`);
        const image = document.getElementById(`image_${cellId}`);

        if (textBox) {
            textBox.style.height = `${newHeight}px`;
            textBox.style.height = `${top}px;`
        }
        if (image) {
            image.style.height = `${newHeight}px`;
        }
        rowRect.setAttribute("height", newHeight);
        const columnData = rowData.column[colIndex];
        columnData.meta.height = newHeight; // Update height in meta
        updateGrid(rowRect, parseFloat(rowRect.getAttribute("width")), newHeight);
    });

    // Adjust the `y` positions of rows below the resized row
    for (let rIndex = rowIndex + 1; rIndex < rowRects.length; rIndex++) {
        rowRects[rIndex].forEach((cell, colIndex) => {
            const currentY = parseFloat(cell.getAttribute("y"));
            const newY = currentY + heightDiff;
            cell.setAttribute("y", newY);

            // Update `y` in originalData for the corresponding cell
            const columnData = originalData.layout.table.row[rIndex].column[colIndex];
            columnData.meta.y = newY;
        });

        for (let rIndex = rowIndex + 1; rIndex < rowRects.length; rIndex++) {
            rowRects[rIndex].forEach(cell => {
                const currentY = parseFloat(cell.getAttribute("y"));
                cell.setAttribute("y", currentY);
                updateGrid(cell, parseFloat(cell.getAttribute("width")), parseFloat(cell.getAttribute("height")));
            });
        }

        // Update the meta `y` for the row
        originalData.layout.table.row[rIndex].meta.y += heightDiff;
    }

    // Handle merged cells
    updateMergedCells(rowRects);

    // Update SVG dimensions
    updateSvgDimensions();

    // Save the new grid state
    saveGridState(rowRects);
    saveState();
}

function updateSvgDimensions() {
    const container = document.getElementById("svg-container");
    const svg = container.querySelector("svg");

    const totalWidth = Array.from(svg.querySelectorAll(".cell-group rect")).reduce((maxWidth, rect) => {
        const rectRight = parseFloat(rect.getAttribute("x")) + parseFloat(rect.getAttribute("width"));
        return Math.max(maxWidth, rectRight);
    }, 0);

    const totalHeight = Array.from(svg.querySelectorAll(".cell-group rect")).reduce((maxHeight, rect) => {
        const rectBottom = parseFloat(rect.getAttribute("y")) + parseFloat(rect.getAttribute("height"));
        return Math.max(maxHeight, rectBottom);
    }, 0);

    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);
}

function updateGrid(rect, colWidth, colHeight) {
    const svgNS = "http://www.w3.org/2000/svg";
    const cellGroup = rect.parentNode;

    if (!cellGroup) return;

    // Remove existing grid cells
    Array.from(cellGroup.querySelectorAll(".grid-cell")).forEach(cell => cell.remove());

    // Redraw grid cells dynamically
    createBackgroundGrid(
        cellGroup,
        parseFloat(rect.getAttribute("x")),
        parseFloat(rect.getAttribute("y")),
        colWidth,
        colHeight
    );
}

function mergeSelectedCells(svg, rowRects) {
    const selectedRects = Array.from(svg.querySelectorAll(".selected"));

    if (selectedRects.length > 1) {
        const xs = [], ys = [], widths = [], heights = [];
        const selectedIds = selectedRects.map((rect) => rect.getAttribute("id"));
        const cellDetails = []; // To store the details of each cell being merged

        selectedRects.forEach((rect) => {
            xs.push(parseFloat(rect.getAttribute("x")));
            ys.push(parseFloat(rect.getAttribute("y")));
            widths.push(parseFloat(rect.getAttribute("width")));
            heights.push(parseFloat(rect.getAttribute("height")));
            const rowIndex = parseInt(rect.getAttribute("data-row-index"));
            const colIndex = parseInt(rect.getAttribute("data-col-index"));
            cellDetails.push({ rowIndex, colIndex, width: widths[widths.length - 1], height: heights[heights.length - 1] });
        });

        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
        const maxY = Math.max(...ys.map((y, i) => y + heights[i]));

        const newWidth = maxX - minX;
        const newHeight = maxY - minY;

        // Hide the original cells
        selectedRects.forEach((rect) => rect.style.display = "none");

        const svgNS = "http://www.w3.org/2000/svg";
        const rectGroup = document.createElementNS(svgNS, "g");
        rectGroup.setAttribute("class", "cell-group");

        const gridGroup = document.createElementNS(svgNS, "g");
        gridGroup.setAttribute("class", "grid-group");
        rectGroup.appendChild(gridGroup);
        const newId = `mergeCell_${Date.now()}`;

        const newRect = document.createElementNS(svgNS, "rect");
        newRect.setAttribute("x", minX);
        newRect.setAttribute("y", minY);
        newRect.setAttribute("width", newWidth);
        newRect.setAttribute("height", newHeight);
        newRect.setAttribute("class", "parent");
        newRect.setAttribute("id", newId);
        newRect.setAttribute("data-merged-cells", selectedIds.join(",")); // Track merged cells
        rectGroup.appendChild(newRect);

        svg.appendChild(rectGroup);

        // Track the relationship in mergeMap
        mergeMap.set(newRect, selectedRects.slice());

        // Update `mergedCellData`
        mergedCellData[newId] = {
            x: minX,
            y: minY,
            width: newWidth,
            height: newHeight,
            children: selectedIds,
        };

        console.log("Merged cells:", mergedCellData);

        selectedRects.forEach((rect) => {
            const rowIndex = parseInt(rect.getAttribute("data-row-index"));
            const colIndex = parseInt(rect.getAttribute("data-col-index"));

            // Ensure rowIndex and colIndex are valid
            if (originalData.layout.table.row[rowIndex] && originalData.layout.table.row[rowIndex].column) {
                originalData.layout.table.row[rowIndex].column[colIndex]['data-merged-parent'] = newId;
            } else {
                console.warn(`Invalid row or column at rowIndex ${rowIndex}, colIndex ${colIndex}`);
            }
        });

        // Attach event listeners
        resize(newRect, rowRects, -1, -1);

        // Call saveGridState with the new details
        saveGridState(rowRects, cellDetails); // Pass cell details for saving

        console.log("Merge and save complete");
        saveState();
    }
}

function updateMergedCells(rowRects) {
    for (const [id, mergedCell] of Object.entries(mergedCellData)) {
        const children = mergedCell.children.map((childId) =>
            rowRects.flat().find((rect) => rect.getAttribute("id") === childId)
        );

        const xs = children.map((rect) => parseFloat(rect.getAttribute("x")));
        const ys = children.map((rect) => parseFloat(rect.getAttribute("y")));
        const widths = children.map((rect) => parseFloat(rect.getAttribute("width")));
        const heights = children.map((rect) => parseFloat(rect.getAttribute("height")));

        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
        const maxY = Math.max(...ys.map((y, i) => y + heights[i]));

        // Update merged cell data
        mergedCell.x = minX;
        mergedCell.y = minY;
        mergedCell.width = maxX - minX;
        mergedCell.height = maxY - minY;

        // Re-render merged cell
        const mergedRect = document.getElementById(id);
        mergedRect.setAttribute("x", mergedCell.x);
        mergedRect.setAttribute("y", mergedCell.y);
        mergedRect.setAttribute("width", mergedCell.width);
        mergedRect.setAttribute("height", mergedCell.height);

        // Update the background grid
        const gridGroup = mergedRect.parentNode.querySelector(".grid-group");
        if (gridGroup) {
            // Clear existing grid
            while (gridGroup.firstChild) {
                gridGroup.removeChild(gridGroup.firstChild);
            }

            // Create new grid
            createBackgroundGrid(
                gridGroup,
                mergedCell.x,
                mergedCell.y,
                mergedCell.width,
                mergedCell.height
            );
        }
    }
}

function unmergeCell(rect) {
    const rectId = rect.getAttribute("id");

    if (!mergeMap.has(rect)) {
        console.warn("No merged cell found in mergeMap to unmerge. Element ID:", rectId);
        return;
    }

    // Retrieve and restore the original cells
    const originalCells = mergeMap.get(rect);
    mergeMap.delete(rect);

    originalCells.forEach((originalCell) => {
        // Restore visibility
        originalCell.style.display = "block"; // Make the cell visible

        // Append the original cell back to the parent SVG container
        rect.parentNode.appendChild(originalCell);

        // Retrieve attributes for grid recreation
        const x = parseFloat(originalCell.getAttribute("x"));
        const y = parseFloat(originalCell.getAttribute("y"));
        const width = parseFloat(originalCell.getAttribute("width"));
        const height = parseFloat(originalCell.getAttribute("height"));

        // Remove any existing grid group associated with this cell
        const existingGridGroup = rect.parentNode.querySelector(`g.grid-group[x="${x}"][y="${y}"]`);
        if (existingGridGroup) {
            existingGridGroup.remove();
        }

        // Create a new group for the grid
        const newGridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        newGridGroup.setAttribute("class", "grid-group");

        // Recreate the background grid for the restored cell
        createBackgroundGrid(newGridGroup, x, y, width, height);

        // Append the grid group after restoring the cell
        rect.parentNode.appendChild(newGridGroup);

        // Debug log for each restored cell
        console.log(`Restored cell with attributes: x=${x}, y=${y}, width=${width}, height=${height}`);
    });

    // Remove the merged cell and update data
    delete mergedCellData[rectId];
    rect.remove();

    // Debug logs for tracking updates
    console.log(`Successfully unmerged cell: ${rectId}`);
    console.log("Updated mergeMap:", Array.from(mergeMap.entries()));
    console.log("Updated mergedCellData:", mergedCellData);

    // Redraw the SVG to ensure the grid is fully updated
    redrawSVG();
    saveState();
}

function redrawSVG() {
    const container = document.getElementById("svg-container");
    container.innerHTML = ""; // Clear existing content
    createSVGLayout(originalData); // Rebuild the layout
}

function updateSVGLayout() {
    const container = document.getElementById("svg-container");
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    createSVGLayout(originalData);
}

function saveGridState(rowRects, mergedCellsDetails = []) {
    const processedMergedRegions = new Set();

    const updatedLayout = {
        layout: {
            table: {
                row: rowRects.map((row, rowIndex) => ({
                    meta: {
                        height: parseFloat(row[0]?.getAttribute("height")) || 0,
                    },
                    column: row
                        .filter((col) => {
                            const cellId = col.getAttribute("id");
                            const mergedRegionId = col.getAttribute("data-merged-parent");

                            if (mergedRegionId && !processedMergedRegions.has(mergedRegionId)) {
                                const mergedCells = [];
                                rowRects.forEach((rRow, rRowIndex) => {
                                    rRow.forEach((cell, colIndex) => {
                                        if (cell.getAttribute("data-merged-parent") === mergedRegionId) {
                                            mergedCells.push({
                                                id: cell.getAttribute("id"),
                                                rowIndex: rRowIndex,
                                                colIndex,
                                                meta: {
                                                    width: parseFloat(cell.getAttribute("width")) || 0,
                                                    height: parseFloat(cell.getAttribute("height")) || 0,
                                                },
                                            });
                                        }
                                    });
                                });

                                mergedCellsDetails.push({
                                    id: mergedRegionId,
                                    x: parseFloat(col.getAttribute("x")),
                                    y: parseFloat(col.getAttribute("y")),
                                    width: parseFloat(col.getAttribute("width")) || 0,
                                    height: parseFloat(col.getAttribute("height")) || 0,
                                    children: mergedCells,
                                });

                                processedMergedRegions.add(mergedRegionId);
                                return false; // Exclude merged region parent cell from columns
                            }

                            return true; // Include non-merged cells
                        })
                        .map((col, colIndex) => ({
                            id: col.getAttribute("id"),
                            rowIndex,
                            colIndex,
                            meta: {
                                width: parseFloat(col.getAttribute("width")) || 0,
                                height: parseFloat(col.getAttribute("height")) || 0,
                            },
                        })),
                })),
                mergedCells: mergedCellsDetails, // Include merged cells details in layout
            },
        },
    };

    fetch("http://localhost:3000/grid.json", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedLayout),
    })
        .then((response) => {
            if (response.ok) {
                console.log("Grid state saved successfully!");
            } else {
                console.error("Failed to save grid state.");
            }
        })
        .catch((error) => {
            console.error("Error saving grid state:", error);
        });
}




document.addEventListener("DOMContentLoaded", function () {
    const container = document.getElementById("svg-container");
    const toolkitItems = document.querySelectorAll(".toolkit-item");


    const svgNS = "http://www.w3.org/2000/svg";

    let selectedShape = null;
    let offsetX, offsetY;




    // Context menu on right-click
    container.addEventListener("contextmenu", function (event) {
        event.preventDefault();

        const target = event.target;
        const cellId = target.getAttribute("id");

        // Skip context menu for the top-left cell (row 0, column 0)
        if (cellId === "cell_00") return;

        selectedCellId = cellId;
        // Remove any existing context menu
        removeContextMenu();

        // Create the context menu element
        const menu = document.createElement("div");
        menu.className = "context-menu";

        // Set initial position
        let menuTop = event.pageY;
        let menuLeft = event.pageX;

        // Adjust the menu position to keep it within the viewport
        const menuWidth = 200; // Approximate width of the menu, adjust as needed
        const menuHeight = 150; // Approximate height of the menu, adjust as needed
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (menuLeft + menuWidth > viewportWidth) {
            menuLeft = viewportWidth - menuWidth - 10; // Adjust to fit within the viewport
        }
        if (menuTop + menuHeight > viewportHeight) {
            menuTop = viewportHeight - menuHeight - 10; // Adjust to fit within the viewport
        }

        menu.style.position = "absolute";
        menu.style.top = `${menuTop}px`;
        menu.style.left = `${menuLeft}px`;

        if (cellId && cellId.startsWith("mergeCell_")) {
            // Logic for merged cells
            const mergedData = mergedCellData[cellId]; // Retrieve metadata for this merged cell
            addMenuOption(menu, "Split Cell", () => splitMergedCell(target));
            addMenuOption(menu, "Add Text", () => addText(cellId));
            addMenuOption(menu, "Upload Photo", () => uploadPhoto(cellId));
        } else if (target.classList.contains("parent")) {
            // Extract column and row indices from cellId
            const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
            if (!cellParts || cellParts.length < 3) return;

            const colIndex = parseInt(cellParts[1], 10);
            const rowIndex = parseInt(cellParts[2], 10);

            if (colIndex === 0) {
                // First column logic
                if (rowIndex > 0) {
                    addMenuOption(menu, "Add Row Above", () => addRow(cellId, "above"));
                    addMenuOption(menu, "Add Row Below", () => addRow(cellId, "below"));
                    if (rowIndex > 1) {
                        addMenuOption(menu, "Delete Row", () => deleteRow(cellId));
                    }
                }
            } else if (rowIndex === 0) {
                // First row logic
                if (colIndex > 0) {
                    addMenuOption(menu, "Add Column Left", () => addColumn(cellId, "left"));
                    addMenuOption(menu, "Add Column Right", () => addColumn(cellId, "right"));
                    if (colIndex > 1) {
                        addMenuOption(menu, "Delete Column", () => deleteColumn(cellId));
                    }
                }
            }
        }

        // Append the context menu to the document
        document.body.appendChild(menu);

        // Close the menu if clicked elsewhere
        document.addEventListener("click", removeContextMenu, { once: true });
    });


    // Close context menu on click elsewhere 
    document.addEventListener("click", removeContextMenu);

    // Event listener to select a cell on single click (with Ctrl for multi-select)
    container.addEventListener("click", function (event) {
        const target = event.target;

        if (target.classList.contains("parent")) {
            const cellId = target.getAttribute("id");

            // Regex to extract column and row indices from the ID
            const cellParts = cellId.match(/(cell|mergeCell)_(\d+)_(\d+)/);
            if (!cellParts || cellParts.length < 4) {
                console.error("Invalid cell ID format:", cellId);
                return;
            }

            const colIndex = parseInt(cellParts[2], 10); // Extracted column index
            const rowIndex = parseInt(cellParts[3], 10); // Extracted row index

            if (rowIndex === 0 && colIndex === 0) {
                // Select all cells
                document.querySelectorAll(".parent").forEach(cell => cell.classList.toggle("selected"));
            } else if (rowIndex === 0) {
                // Select all cells in the clicked column
                document.querySelectorAll(".parent").forEach(cell => {
                    const match = cell.id.match(/^(cell|mergeCell)_(\d+)_(\d+)$/);
                    if (match && parseInt(match[2], 10) === colIndex) {
                        cell.classList.toggle("selected");
                    }
                });
            } else if (colIndex === 0) {
                // Select all cells in the clicked row
                document.querySelectorAll(".parent").forEach(cell => {
                    const match = cell.id.match(/^(cell|mergeCell)_(\d+)_(\d+)$/);
                    if (match && parseInt(match[3], 10) === rowIndex) {
                        cell.classList.toggle("selected");
                    }
                });
            } else {
                // Normal single-cell selection
                if (event.ctrlKey) {
                    target.classList.toggle("selected");
                } else {
                    document.querySelectorAll(".parent.selected").forEach(cell => cell.classList.remove("selected"));
                    target.classList.add("selected");
                }
            }
        }
    });


    function addMenuOption(menu, text, action) {
        const option = document.createElement("div");
        option.className = "menu-option";
        option.textContent = text;
        option.onclick = action;
        menu.appendChild(option);
    }

    function removeContextMenu() {
        const contextMenu = document.querySelector(".context-menu");
        if (contextMenu) {
            contextMenu.remove();
        }
    }

    function removeContextMenu() {
        const existingMenu = document.querySelector(".context-menu");
        if (existingMenu) existingMenu.remove();
    }

    function addRow(cellId, position) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) {
            console.error("Invalid cell ID format:", cellId);
            return;
        }

        const rowIndex = parseInt(cellParts[2]);
        const insertIndex = position === "above" ? rowIndex : rowIndex + 1;

        const refRow = originalData.layout.table.row[rowIndex];
        const refRowHeight = parseFloat(refRow.meta.height);
        const newRowHeight = 100; // Fixed height for the new row

        saveState();

        // Adjust `y` positions for rows below
        for (let i = insertIndex; i < originalData.layout.table.row.length; i++) {
            const row = originalData.layout.table.row[i];
            row.meta.y += newRowHeight;
            row.column.forEach(cell => {
                cell.meta.y += newRowHeight;
            });
        }

        // Create new row
        const newRow = {
            meta: {
                ...refRow.meta,
                y: position === "above" ? refRow.meta.y : refRow.meta.y + refRowHeight,
                height: newRowHeight,
            },
            column: refRow.column.map(cell => ({
                ...cell,
                meta: {
                    ...cell.meta,
                    y: position === "above" ? cell.meta.y : cell.meta.y + refRowHeight,
                    height: newRowHeight,
                },
            })),
        };

        // Adjust only the affected merged cells
        Object.entries(mergedCellData).forEach(([id, mergedCell]) => {
            if (mergedCell.y >= refRow.meta.y) {
                mergedCell.y += newRowHeight;
                mergedCell.height += newRowHeight;
            }
        });

        // Insert new row into the layout
        originalData.layout.table.row.splice(insertIndex, 0, newRow);

        // Redraw layout
        redrawSVG();
        console.log(`Row added ${position} at index ${rowIndex}`);
    }

    function addColumn(cellId, position) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) {
            console.error("Invalid cell ID format:", cellId);
            return;
        }

        const colIndex = parseInt(cellParts[1]);
        const insertIndex = position === "left" ? colIndex : colIndex + 1;

        saveState();

        // Adjust only the affected merged cells
        Object.entries(mergedCellData).forEach(([id, mergedCell]) => {
            if (mergedCell.x >= colIndex * 100) {
                mergedCell.x += 100;
                mergedCell.width += 100;
            }
        });

        // Insert new column into each row
        originalData.layout.table.row.forEach(row => {
            const refCell = row.column[colIndex];
            const newCell = {
                ...refCell,
                meta: {
                    ...refCell.meta,
                    x: position === "left" ? refCell.meta.x : refCell.meta.x + refCell.meta.width,
                    width: 100,
                },
            };
            row.column.splice(insertIndex, 0, newCell);
        });

        // Redraw layout
        redrawSVG();
        saveState();
        console.log(`Column added ${position} at index ${colIndex}`);
    }

    function deleteRow(cellId) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) {
            console.error("Invalid cell ID format:", cellId);
            return;
        }

        const rowIndex = parseInt(cellParts[2]);
        if (originalData.layout.table.row.length > 1) {
            saveState();
            // Adjust merged cells
            mergeMap.forEach((originalCells, mergedRect) => {
                const mergedRowIndices = originalCells.map(cell => parseInt(cell.getAttribute("data-row-index")));
                if (mergedRowIndices.includes(rowIndex)) {
                    const height = parseFloat(mergedRect.getAttribute("height"));
                    mergedRect.setAttribute("height", height - originalData.layout.table.row[rowIndex].meta.height);
                } else if (Math.min(...mergedRowIndices) > rowIndex) {
                    const y = parseFloat(mergedRect.getAttribute("y"));
                    mergedRect.setAttribute("y", y - originalData.layout.table.row[rowIndex].meta.height);
                }
            });

            // Delete the row
            originalData.layout.table.row.splice(rowIndex, 1);

            // Update the layout
            document.getElementById("svg-container").innerHTML = "";
            createSVGLayout(originalData);

            // Save the updated state


            console.log(`Row deleted at index ${rowIndex}`);
        } else {
            console.warn("Cannot delete the last remaining row.");
        }
    }

    function deleteColumn(cellId) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) {
            console.error("Invalid cell ID format:", cellId);
            return;
        }

        const colIndex = parseInt(cellParts[1]);
        if (originalData.layout.table.row[0].column.length > 1) {
            saveState();
            originalData.layout.table.row.forEach(row => {
                // Adjust merged cells
                mergeMap.forEach((originalCells, mergedRect) => {
                    const mergedColIndices = originalCells.map(cell => parseInt(cell.getAttribute("data-col-index")));
                    if (mergedColIndices.includes(colIndex)) {
                        const width = parseFloat(mergedRect.getAttribute("width"));
                        mergedRect.setAttribute("width", width - row.column[colIndex].meta.width);
                    } else if (Math.min(...mergedColIndices) > colIndex) {
                        const x = parseFloat(mergedRect.getAttribute("x"));
                        mergedRect.setAttribute("x", x - row.column[colIndex].meta.width);
                    }
                });

                // Delete the column
                row.column.splice(colIndex, 1);
            });

            // Update the layout
            document.getElementById("svg-container").innerHTML = "";
            createSVGLayout(originalData);

            // Save the updated state


            console.log(`Column deleted at index ${colIndex}`);
        } else {
            console.warn("Cannot delete the last remaining column.");
        }
    }



    // Initialize drag from the toolkit
    toolkitItems.forEach(item => {
        item.addEventListener("dragstart", event => {
            const shapeType = item.getAttribute("data-shape");
            if (!shapeType) {
                console.error("Shape type is not defined on the dragged item.");
                return;
            }
            event.dataTransfer.setData("shapeType", shapeType);
            console.log(`Dragging shape: ${shapeType}`);
        });
    });

    container.addEventListener("dragover", (event) => {
        event.preventDefault(); // Allow drop
        const parent = container.getElementsByClassName("parent");
        for (let i = 0; i < parent.length; i++) {
            const cell = parent[i];
            const cellRect = cell.getBoundingClientRect();

            // Check if the mouse is within the cell's area
            if (event.clientX >= cellRect.left && event.clientX <= cellRect.right &&
                event.clientY >= cellRect.top && event.clientY <= cellRect.bottom) {
                hoveredCellId = cell.id;
                break;
            }
        }
    });

    // Handle drop event
    container.addEventListener("drop", (event) => {
        event.preventDefault();

        if (!hoveredCellId) {
            console.error("No valid cell to drop on.");
            return;
        }

        const shapeType = event.dataTransfer.getData("shapeType");
        if (!shapeType) {
            console.error("No shape type found during drop.");
            return;
        }

        const svg = container.querySelector("svg");
        const svgRect = svg.getBoundingClientRect();
        const dropX = event.clientX - svgRect.left;
        const dropY = event.clientY - svgRect.top;

        // Dynamically fetch updated global cell dimensions
        const cellWidth = globalWidth || 100; // Default to 100 if globalWidth is undefined
        const cellHeight = globalHeight || 100; // Default to 100 if globalHeight is undefined

        // Snap to the nearest cell based on the current cell size
        const snappedX = Math.floor(dropX / cellWidth) * cellWidth;
        const snappedY = Math.floor(dropY / cellHeight) * cellHeight;

        const row = Math.floor(snappedY / cellHeight); // Row based on Y and cellHeight
        const col = Math.floor(snappedX / cellWidth);  // Column based on X and cellWidth

        console.log(`Dropped on Cell ID: ${hoveredCellId}, Row: ${row}, Col: ${col}`);

        let newShape;
        const cellX = snappedX;
        const cellY = snappedY;

        // Create the shape based on the shape type
        if (shapeType === "circle") {
            newShape = document.createElementNS(svgNS, "circle");
            newShape.setAttribute("cx", cellX + cellWidth / 2);
            newShape.setAttribute("cy", cellY + cellHeight / 2);
            newShape.setAttribute("r", Math.min(cellWidth, cellHeight) / 2 - 5);
            saveState();
        } else if (shapeType === "square") {
            newShape = document.createElementNS(svgNS, "rect");
            newShape.setAttribute("x", cellX);
            newShape.setAttribute("y", cellY);
            newShape.setAttribute("width", cellWidth);
            newShape.setAttribute("height", cellHeight);
            saveState();
        } else if (shapeType === "triangle") {
            newShape = document.createElementNS(svgNS, "polygon");
            const points = `
                ${cellX + cellWidth / 2},${cellY}
                ${cellX},${cellY + cellHeight}
                ${cellX + cellWidth},${cellY + cellHeight}
            `;
            newShape.setAttribute("points", points.trim());
            saveState();
        } else if (shapeType === "rectangle") {
            newShape = document.createElementNS(svgNS, "rect");
            newShape.setAttribute("x", cellX);
            newShape.setAttribute("y", cellY);
            newShape.setAttribute("width", cellWidth * 2);
            newShape.setAttribute("height", cellHeight);
            saveState();
        } else if (shapeType === "rhombus") {
            newShape = document.createElementNS(svgNS, "polygon");
            const points = `
                ${cellX + cellWidth / 2},${cellY}
                ${cellX},${cellY + cellHeight / 2}
                ${cellX + cellWidth / 2},${cellY + cellHeight}
                ${cellX + cellWidth},${cellY + cellHeight / 2}
            `;
            newShape.setAttribute("points", points.trim());
            saveState();
        } else if (shapeType === "parallelogram") {
            newShape = document.createElementNS(svgNS, "polygon");
            const points = `
                ${cellX + cellWidth / 4},${cellY}
                ${cellX},${cellY + cellHeight}
                ${cellX + cellWidth},${cellY + cellHeight}
                ${cellX + (3 * cellWidth) / 4},${cellY}
            `;
            newShape.setAttribute("points", points.trim());
            saveState();
        } else if (shapeType === "text") {
            addText(hoveredCellId);
            saveState();
        } else if (shapeType === "image") {
            uploadPhoto(hoveredCellId);
            saveState();
        }

        if (newShape) {
            newShape.setAttribute("fill", "white");
            newShape.setAttribute("stroke", "black");
            newShape.setAttribute("stroke-width", "2");
            newShape.setAttribute("class", "dropped-shape draggable");
            newShape.addEventListener("mousedown", startDrag);
            svg.appendChild(newShape);
            addResizeHandles(newShape);
            console.log(`Shape "${shapeType}" placed in cell: ${hoveredCellId}`);


        }
        saveState();
    });

    // Dragging within SVG
    const startDrag = event => {
        if (event.target.classList.contains("draggable")) {
            selectedShape = event.target;
            const shapeType = selectedShape.tagName;
            if (shapeType === "circle") {
                offsetX = event.offsetX - selectedShape.getAttribute("cx");
                offsetY = event.offsetY - selectedShape.getAttribute("cy");
            } else if (shapeType === "rect") {
                offsetX = event.offsetX - selectedShape.getAttribute("x");
                offsetY = event.offsetY - selectedShape.getAttribute("y");
            } else if (shapeType === "polygon") {
                // Add logic for dragging triangles
                offsetX = 0;
                offsetY = 0;
            }
            saveState();
            container.addEventListener("mousemove", drag);
            container.addEventListener("mouseup", endDrag);
        }
    };

    const drag = event => {
        const cellWidth = 10;
        const cellHeight = 10;
        if (!selectedShape) return;

        const svgRect = container.querySelector("svg").getBoundingClientRect();
        const dragX = event.clientX - svgRect.left;
        const dragY = event.clientY - svgRect.top;

        const snappedX = Math.floor(dragX / cellWidth) * cellWidth;
        const snappedY = Math.floor(dragY / cellHeight) * cellHeight;

        if (selectedShape.tagName === "circle") {
            selectedShape.setAttribute("cx", snappedX + cellWidth / 2);
            selectedShape.setAttribute("cy", snappedY + cellHeight / 2);
        } else if (selectedShape.tagName === "rect") {
            selectedShape.setAttribute("x", snappedX);
            selectedShape.setAttribute("y", snappedY);
        } else if (selectedShape.tagName === "polygon") {
            // Adjust triangle points
            const points = `
                ${snappedX + cellWidth / 2},${snappedY}
                ${snappedX},${snappedY + cellHeight}
                ${snappedX + cellWidth},${snappedY + cellHeight}
            `;
            selectedShape.setAttribute("points", points.trim());
        }
        saveState();
        // Update the positions of resize handles if they exist
        if (selectedShape.resizeHandles) {
            updateHandles(selectedShape, selectedShape.resizeHandles, 6); // Assuming 6 is the size of the handles
        }
    };

    const endDrag = () => {
        if (selectedShape) {
            saveState(); // Save the final state after dragging
        }
        selectedShape = null;
        svgContainer.removeEventListener("mousemove", drag);
        svgContainer.removeEventListener("mouseup", endDrag);
    };

    function addText(cellId) {
        const cell = document.getElementById(cellId);

        // Create the editable div
        const textBox = document.createElement("div");
        textBox.setAttribute("id", `text_${cellId}`);
        textBox.setAttribute("class", "text-box");
        textBox.setAttribute("contenteditable", "true");
        textBox.setAttribute("placeholder", "Enter text...");
        textBox.style.position = "absolute";
        textBox.style.left = `${cell.getBoundingClientRect().x}px`;
        textBox.style.top = `${cell.getBoundingClientRect().y}px`;
        textBox.style.width = `${cell.getBoundingClientRect().width}px`;
        textBox.style.height = `${cell.getBoundingClientRect().height}px`;
        textBox.style.border = "1px solid #ccc";
        textBox.style.padding = "5px";
        textBox.style.boxSizing = "border-box";
        textBox.style.overflow = "hidden";
        textBox.style.display = "flex";
        textBox.style.justifyContent = "flex-start";
        textBox.style.alignItems = "flex-start";
        textBox.style.background = "white";
        textBox.style.wordWrap = "break-word";
        textBox.style.wordBreak = "break-word";
        textBox.style.overflowWrap = "break-word";
        textBox.style.whiteSpace = "pre-wrap";
        textBox.style.resize = "auto";

        // Hide scrollbar but enable scrolling
        textBox.style.overflowY = "scroll";
        textBox.style.scrollbarWidth = "none"; // For Firefox
        textBox.style.msOverflowStyle = "none"; // For Internet Explorer/Edge

        // Add the textbox to the DOM
        document.body.appendChild(textBox);


        const closeButton = document.createElement("button");
        closeButton.textContent = "X";
        closeButton.style.position = "absolute";
        closeButton.style.display = "none"; // Initially hidden
        closeButton.style.zIndex = "1000";
        closeButton.style.cursor = "pointer";

        document.body.appendChild(closeButton);
        textBox.focus();

        document.querySelectorAll(".toolkit-item").forEach((button) => {
            button.addEventListener("click", (event) => {
                const shape = event.currentTarget.getAttribute("data-shape");
                const textBox = document.querySelector(".text-box"); // Assumes only one active text box at a time

                if (textBox) {
                    switch (shape) {
                        case "alighn-left":
                            textBox.style.justifyContent = "flex-start";

                            break;
                        case "alighn-center":
                            textBox.style.justifyContent = "center";

                            break;
                        case "alighn-right":
                            textBox.style.justifyContent = "flex-end";

                            break;
                    }
                }
            });
        });

        // Function to update textbox position and dimensions dynamically
        const updateTextBoxPosition = () => {
            const rect = cell.getBoundingClientRect();
            textBox.style.left = `${rect.left}px`;
            textBox.style.top = `${rect.top}px`;
            textBox.style.width = `${rect.width}px`;
            textBox.style.height = `${rect.height}px`;

            // Update close button position
            closeButton.style.left = `${rect.right - 20}px`;
            closeButton.style.top = `${rect.top}px`;
        };

        // Initial update
        updateTextBoxPosition();

        // Use a MutationObserver to track position and size changes of the cell
        const observer = new MutationObserver(updateTextBoxPosition);
        observer.observe(cell, { attributes: true, childList: false, subtree: false });

        // ResizeObserver for further adjustments if required
        const resizeObserver = new ResizeObserver(updateTextBoxPosition);
        resizeObserver.observe(cell);

        // Show the close button on hover
        textBox.addEventListener("mouseenter", () => {
            closeButton.style.display = "block";
        });
        textBox.addEventListener("mouseleave", () => {
            closeButton.style.display = "none";
        });

        // Close button to remove textBox
        closeButton.addEventListener("click", function () {
            textBox.remove();
            closeButton.remove();
            observer.disconnect();
            resizeObserver.disconnect();
            elementsMap.delete(cellId);
        });
        // saveState();
        // Store the text box and close button in the map
        elementsMap.set(cellId, { element: textBox, closeButton });

    }

    function uploadPhoto(cellId) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", function (event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    const img = document.createElement("img");
                    img.src = e.target.result;
                    img.setAttribute("id", `image_${cellId}`);
                    const cell = document.getElementById(cellId);
                    img.style.position = "absolute";
                    img.style.left = `${cell.getBoundingClientRect().left}px`;
                    img.style.top = `${cell.getBoundingClientRect().top}px`;
                    img.style.width = `${cell.getBoundingClientRect().width}px`;
                    img.style.height = `${cell.getBoundingClientRect().height}px`;

                    // Create the close button
                    const closeButton = document.createElement("button");
                    closeButton.textContent = "X";
                    closeButton.style.position = "absolute";
                    closeButton.style.display = "none"; // Initially hidden
                    closeButton.style.zIndex = "1000";
                    closeButton.style.cursor = "pointer";

                    // Append both elements to the body
                    document.body.appendChild(img);
                    document.body.appendChild(closeButton);

                    // Update close button position dynamically
                    const updateCloseButtonPosition = () => {
                        closeButton.style.left = `${img.getBoundingClientRect().right - 20}px`;
                        closeButton.style.top = `${img.getBoundingClientRect().top}px`;
                    };
                    updateCloseButtonPosition();

                    // Show the close button on hover
                    img.addEventListener("mouseenter", () => {
                        closeButton.style.display = "block";
                    });
                    img.addEventListener("mouseleave", () => {
                        closeButton.style.display = "none";
                    });

                    // Add event listener to close button to delete image
                    closeButton.addEventListener("click", function () {
                        img.remove();
                        closeButton.remove();
                        elementsMap.delete(cellId);

                    });

                    // Store the image and close button in the map
                    elementsMap.set(cellId, { element: img, closeButton });
                };
                reader.readAsDataURL(file);
            }

        });
        input.click();

    }

    const fontTypes = ["Arial", "Verdana", "Times New Roman", "Courier New", "Georgia"];
    const fontSizes = ["12px", "14px", "16px", "18px", "20px", "24px", "30px"];

    // Populate font type dropdown
    const fontTypeDropdown = document.getElementById("font-type-dropdown");
    fontTypes.forEach((font) => {
        const option = document.createElement("option");
        option.value = font;
        option.textContent = font;
        fontTypeDropdown.appendChild(option);
    });

    // Populate font size dropdown
    const fontSizeDropdown = document.getElementById("font-size-dropdown");
    fontSizes.forEach((size) => {
        const option = document.createElement("option");
        option.value = size;
        option.textContent = size;
        fontSizeDropdown.appendChild(option);
    });

    // Event listener for font type change
    fontTypeDropdown.addEventListener("change", () => {
        const selectedFont = fontTypeDropdown.value;
        const textBox = document.querySelector(".text-box");
        if (textBox) {
            textBox.style.fontFamily = selectedFont;
        }
    });

    // Event listener for font size change
    fontSizeDropdown.addEventListener("change", () => {
        const selectedSize = fontSizeDropdown.value;
        const textBox = document.querySelector(".text-box");
        if (textBox) {
            textBox.style.fontSize = selectedSize;
        }
    });

    // Ensure the dropdowns reflect the current font of the active text box
    document.addEventListener("click", (event) => {
        const textBox = event.target.closest(".text-box");
        if (textBox) {
            const currentFont = window.getComputedStyle(textBox).fontFamily.replace(/['"]/g, "");
            const currentSize = window.getComputedStyle(textBox).fontSize;

            // Set dropdowns to match current font and size
            fontTypeDropdown.value = fontTypes.includes(currentFont) ? currentFont : "";
            fontSizeDropdown.value = fontSizes.includes(currentSize) ? currentSize : "";
        }
    });

    function addResizeHandles(shape) {
        const resizeHandleSize = 6; // Handle size
        const svg = shape.ownerSVGElement;
        const handles = [];
    
        const positions = [
            { cursor: "nw-resize" },
            { cursor: "ne-resize" },
            { cursor: "sw-resize" },
            { cursor: "se-resize" },
        ];
    
        positions.forEach((pos) => {
            const handle = document.createElementNS(svgNS, "rect");
            handle.setAttribute("width", resizeHandleSize);
            handle.setAttribute("height", resizeHandleSize);
            handle.setAttribute("fill", "blue");
            handle.setAttribute("class", "resize-handle");
            handle.style.cursor = pos.cursor;
            handle.style.display = "none"; // Initially hidden
    
            handle.addEventListener("mousedown", (event) => startResize(event, shape, pos.cursor, handles));
            handles.push(handle);
            svg.appendChild(handle); // Add handles directly to the SVG container
        });
    
        shape.resizeHandles = handles;
        updateHandles(shape, handles, resizeHandleSize);
    
        shape.addEventListener("mouseenter", () => showHandles(handles));
        shape.addEventListener("mouseleave", () => hideHandles(handles));
        shape.addEventListener("mousedown", () => showHandles(handles));
        return handles;
    }
    

    // Show handles
    function showHandles(handles) {
        handles.forEach((handle) => (handle.style.display = "block"));
    }

    // Hide handles
    function hideHandles(handles) {
        handles.forEach((handle) => (handle.style.display = "none"));
    }

    // Update function to dynamically position handles
    function updateHandles(shape, handles, handleSize) {
        const shapeBBox = shape.getBBox();
    
        handles[0].setAttribute("x", shapeBBox.x - handleSize / 2); // Top-left
        handles[0].setAttribute("y", shapeBBox.y - handleSize / 2);
    
        handles[1].setAttribute("x", shapeBBox.x + shapeBBox.width - handleSize / 2); // Top-right
        handles[1].setAttribute("y", shapeBBox.y - handleSize / 2);
    
        handles[2].setAttribute("x", shapeBBox.x - handleSize / 2); // Bottom-left
        handles[2].setAttribute("y", shapeBBox.y + shapeBBox.height - handleSize / 2);
    
        handles[3].setAttribute("x", shapeBBox.x + shapeBBox.width - handleSize / 2); // Bottom-right
        handles[3].setAttribute("y", shapeBBox.y + shapeBBox.height - handleSize / 2);
    }
    

    function startResize(event, shape, cursor, handles) {
        event.stopPropagation(); // Prevent triggering the shape's drag event
        event.preventDefault();
        showHandles(handles);
    
        const startX = event.clientX;
        const startY = event.clientY;
        const bbox = shape.getBBox();
    
        function doResize(event) {
            let dx = event.clientX - startX;
            let dy = event.clientY - startY;
    
            dx = Math.round(dx / 10) * 10; // Snap resizing
            dy = Math.round(dy / 10) * 10;
    
            if (cursor === "nw-resize") {
                shape.setAttribute("x", bbox.x + dx);
                shape.setAttribute("y", bbox.y + dy);
                shape.setAttribute("width", Math.max(10, bbox.width - dx));
                shape.setAttribute("height", Math.max(10, bbox.height - dy));
            } else if (cursor === "ne-resize") {
                shape.setAttribute("y", bbox.y + dy);
                shape.setAttribute("width", Math.max(10, bbox.width + dx));
                shape.setAttribute("height", Math.max(10, bbox.height - dy));
            } else if (cursor === "sw-resize") {
                shape.setAttribute("x", bbox.x + dx);
                shape.setAttribute("width", Math.max(10, bbox.width - dx));
                shape.setAttribute("height", Math.max(10, bbox.height + dy));
            } else if (cursor === "se-resize") {
                shape.setAttribute("width", Math.max(10, bbox.width + dx));
                shape.setAttribute("height", Math.max(10, bbox.height + dy));
            }
    
            updateHandles(shape, handles, 6);
        }
    
        function stopResize() {
            document.removeEventListener("mousemove", doResize);
            document.removeEventListener("mouseup", stopResize);
            hideHandles(handles);
        }
    
        document.addEventListener("mousemove", doResize);
        document.addEventListener("mouseup", stopResize);
    }
    

    // Global variables for selected shape and context menu


    // Add a right-click menu for shapes
    svgContainer.addEventListener("contextmenu", (event) => {
        event.preventDefault();

        // Close any existing context menu
        if (contextMenu) {
            contextMenu.remove();
        }

        // Check if the target is a shape
        if (!event.target.classList.contains("draggable")) return;

        // Store the clicked shape
        selectedShape = event.target;

        // Create the context menu
        contextMenu = document.createElement("div");
        contextMenu.style.position = "absolute";
        contextMenu.style.left = `${event.pageX}px`;
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.background = "#fff";
        contextMenu.style.border = "1px solid #ccc";
        contextMenu.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
        contextMenu.style.padding = "5px";
        contextMenu.style.cursor = "pointer";
        contextMenu.style.zIndex = "1000";

        // Add "Delete" option
        const deleteOption = document.createElement("div");
        deleteOption.textContent = "Delete";
        deleteOption.style.padding = "5px";
        deleteOption.style.fontSize = "14px";
        deleteOption.style.color = "red";
        deleteOption.addEventListener("click", () => {
            if (selectedShape) {
                selectedShape.remove();
                selectedShape = null;
            }
            contextMenu.remove();
            contextMenu = null;
        });

        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);

        // Close the menu when clicking outside
        document.addEventListener("click", closeContextMenu, { once: true });
    });

    // Function to close the context menu
    const closeContextMenu = () => {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    };

    // Add keyboard delete functionality
    document.addEventListener("keydown", (event) => {
        if (event.key === "Delete" && selectedShape) {
            selectedShape.remove();
            selectedShape = null;
        }
    });

    // Add mouse down event to select shapes
    svgContainer.addEventListener("mousedown", (event) => {
        if (event.target.classList.contains("draggable")) {
            selectedShape = event.target;
        } else {
            selectedShape = null;
        }
    });

    // Cleanup context menu on window resize or scroll
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu);

});


function saveState() {
    const svgElement = document.getElementById("svg-container").querySelector("svg");
    const textBox = document.querySelector(".text-box");

    const currentState = {
        svg: svgElement.outerHTML,
        textBox: textBox
            ? {
                left: textBox.style.left,
                top: textBox.style.top,
                width: textBox.style.width,
                height: textBox.style.height,
                content: textBox.innerHTML,
            }
            : null,
    };

    history.push(JSON.stringify(currentState));
    redoStack.length = 0; // Clear redo stack on new action
}


function undo() {
    if (history.length > 0) {
        const previousState = JSON.parse(history.pop());
        redoStack.push(
            JSON.stringify({
                svg: document.getElementById("svg-container").querySelector("svg").outerHTML,
                textBox: document.querySelector(".text-box")
                    ? {
                        left: document.querySelector(".text-box").style.left,
                        top: document.querySelector(".text-box").style.top,
                        width: document.querySelector(".text-box").style.width,
                        height: document.querySelector(".text-box").style.height,
                        content: document.querySelector(".text-box").innerHTML,
                    }
                    : null,
            })
        );

        // Restore SVG
        document.getElementById("svg-container").innerHTML = previousState.svg;

        // Restore Text Box
        if (previousState.textBox) {
            const textBox = document.querySelector(".text-box");
            textBox.style.left = previousState.textBox.left;
            textBox.style.top = previousState.textBox.top;
            textBox.style.width = previousState.textBox.width;
            textBox.style.height = previousState.textBox.height;
            textBox.innerHTML = previousState.textBox.content;
        }
    } else {
        console.warn("No more actions to undo");
    }
}


function redo() {
    if (redoStack.length > 0) {
        const nextState = JSON.parse(redoStack.pop());
        history.push(
            JSON.stringify({
                svg: document.getElementById("svg-container").querySelector("svg").outerHTML,
                textBox: document.querySelector(".text-box")
                    ? {
                        left: document.querySelector(".text-box").style.left,
                        top: document.querySelector(".text-box").style.top,
                        width: document.querySelector(".text-box").style.width,
                        height: document.querySelector(".text-box").style.height,
                        content: document.querySelector(".text-box").innerHTML,
                    }
                    : null,
            })
        );

        // Restore SVG
        document.getElementById("svg-container").innerHTML = nextState.svg;

        // Restore Text Box
        if (nextState.textBox) {
            const textBox = document.querySelector(".text-box");
            textBox.style.left = nextState.textBox.left;
            textBox.style.top = nextState.textBox.top;
            textBox.style.width = nextState.textBox.width;
            textBox.style.height = nextState.textBox.height;
            textBox.innerHTML = nextState.textBox.content;
        }
    } else {
        console.warn("No more actions to redo");
    }
}





// Add Event Listeners for Ctrl+Z and Ctrl+Y
document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "z") {
        event.preventDefault();
        undo();
    }
    if (event.ctrlKey && event.key === "y") {
        event.preventDefault();
        redo();
    }
});
