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
    container.innerHTML = "";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");

    const calculateDimensions = () => {
        const totalWidth = data.layout.table.row[0].column.reduce((sum, col) => sum + col.meta.width, 0);
        const totalHeight = data.layout.table.row.reduce((sum, row) => sum + row.meta.height, 0);
        return { totalWidth, totalHeight };
    };

    const { totalWidth, totalHeight } = calculateDimensions();
    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", totalHeight);
    svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);

    let currentY = 0, rowRects = [];

    data.layout.table.row.forEach((row, rowIndex) => {
        let currentX = 0;
        row.column.forEach((col, colIndex) => {
            const rectGroup = document.createElementNS(svgNS, "g");
            rectGroup.setAttribute("class", "cell-group");

            const gridGroup = document.createElementNS(svgNS, "g");
            gridGroup.setAttribute("class", "grid-group");
            createBackgroundGrid(gridGroup, currentX, currentY, col.meta.width, col.meta.height);
            rectGroup.appendChild(gridGroup);

            const cellId = `cell_${colIndex}_${rowIndex}`;
            const rect = document.createElementNS(svgNS, "rect");
            rect.setAttribute("x", currentX);
            rect.setAttribute("y", currentY);
            rect.setAttribute("width", col.meta.width);
            rect.setAttribute("height", col.meta.height);
            rect.setAttribute("class", "parent");
            rect.setAttribute("id", cellId);
            rect.setAttribute("fill", "none");

            if (!Object.entries(mergedCellData).some(([_, mc]) => mc.children.includes(cellId))) {
                rectGroup.appendChild(rect);
            } else {
                rect.style.display = "none";
            }

            if (!rowRects[rowIndex]) rowRects[rowIndex] = [];
            rowRects[rowIndex].push(rect);

            svg.appendChild(rectGroup);
            resize(rect, rowRects, rowIndex, colIndex);
            currentX += col.meta.width;
        });
        currentY += row.meta.height;
    });

    Object.entries(mergedCellData).forEach(([id, mergedCell]) => {
        const children = mergedCell.children.map((childId) =>
            rowRects.flat().find((rect) => rect.getAttribute("id") === childId)
        );

        if (children.some((child) => !child)) return;

        const xs = children.map((rect) => parseFloat(rect.getAttribute("x")));
        const ys = children.map((rect) => parseFloat(rect.getAttribute("y")));
        const widths = children.map((rect) => parseFloat(rect.getAttribute("width")));
        const heights = children.map((rect) => parseFloat(rect.getAttribute("height")));

        mergedCell.x = Math.min(...xs);
        mergedCell.y = Math.min(...ys);
        mergedCell.width = Math.max(...xs.map((x, i) => x + widths[i])) - mergedCell.x;
        mergedCell.height = Math.max(...ys.map((y, i) => y + heights[i])) - mergedCell.y;

        const newRect = document.createElementNS(svgNS, "rect");
        newRect.setAttribute("x", mergedCell.x);
        newRect.setAttribute("y", mergedCell.y);
        newRect.setAttribute("width", mergedCell.width);
        newRect.setAttribute("height", mergedCell.height);
        newRect.setAttribute("class", "parent merged");
        newRect.setAttribute("id", id);

        mergeMap.set(newRect, children);
        svg.appendChild(newRect);
        resize(newRect, rowRects, -1, -1);
    });

    container.appendChild(svg);
    svg.addEventListener("dblclick", () => mergeSelectedCells(svg, rowRects));
    saveGridState(rowRects);
}

function createBackgroundGrid(group, startX, startY, colWidth, colHeight) {
    const svgNS = "http://www.w3.org/2000/svg", cellSize = 10;
    const cols = Math.ceil(colWidth / cellSize), rows = Math.ceil(colHeight / cellSize);

    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            const rect = document.createElementNS(svgNS, "rect");
            rect.setAttribute("x", startX + x * cellSize);
            rect.setAttribute("y", startY + y * cellSize);
            rect.setAttribute("width", cellSize);
            rect.setAttribute("height", cellSize);
            rect.setAttribute("class", "grid-cell");
            rect.setAttribute("fill", "none");
            rect.setAttribute("stroke", "#ccc");
            rect.setAttribute("stroke-width", "0.1%");
            group.appendChild(rect);
        }
    }
}

function hoverOnCell(cell) {
    cell.addEventListener("mouseover", (e) => {
        document.getElementById("hoverdCell").innerText = e.target.id;
    });
}

function resize(rect, rowRects, rowIndex, colIndex) {
    rect.addEventListener("mouseover", (e) => {
        if (!resizing) {
            const isMerged = mergeMap.has(rect);
            setCursor(e, rect, rowIndex, rowRects[rowIndex], colIndex, isMerged);
        }
    });

    rect.addEventListener("mouseout", () => {
        if (!resizing) {
            document.body.classList.remove("col-resize", "row-resize", "nw-resize");
        }
    });

    rect.addEventListener("mousedown", (e) => {
        const isMerged = mergeMap.has(rect);
        if (isMerged) {
            handleMergedCellResize(e, rect, rowRects);
        } else {
            handleMouseDown(e, rect, rowRects, rowIndex, colIndex);
        }
    });

    rect.addEventListener("click", (e) => {
        if (e.detail === 3) {
            unmergeCell(rect, rowRects);
        }
    });
}


function handleMergedCellResize(e, rect, rowRects) {
    const { clientX: startX, clientY: startY } = e;
    const startWidth = +rect.getAttribute("width");
    const startHeight = +rect.getAttribute("height");
    const direction = getResizeDirection(e, rect);

    if (!direction || !direction.includes("col-resize")) return;

    const mergedCellId = rect.getAttribute("id");
    const mergedCell = mergedCellData[mergedCellId];
    resizing = true;

    const onMouseMove = (e) => {
        const dx = Math.round((e.clientX - startX) / 10) * 10;
        const newWidth = Math.max(startWidth + dx, 100);

        // Update merged cell dimensions
        rect.setAttribute("width", newWidth);
        mergedCell.width = newWidth;

        // Adjust column widths for vertically aligned cells
        updateColumnCells(mergedCell, rowRects, newWidth);

        updateMergedCells(rowRects); // Recalculate grid structure
    };

    const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        resizing = false;
        saveGridState(rowRects);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
}

function updateColumnCells(mergedCell, rowRects, newWidth) {
    const affectedColumnCells = getColumnCells(mergedCell, rowRects);
    affectedColumnCells.forEach((cell) => {
        const cellRect = document.getElementById(cell.id);
        if (cellRect) {
            cellRect.setAttribute("width", newWidth);
            cell.width = newWidth;
        }
    });
}

function getColumnCells(mergedCell, rowRects) {
    const columnStart = mergedCell.x;
    const columnEnd = mergedCell.x + mergedCell.width;

    return rowRects.flat().filter((cell) => {
        const cellStart = cell.x;
        const cellEnd = cell.x + cell.width;
        return (
            (cellStart >= columnStart && cellStart < columnEnd) || // Overlaps column start
            (cellEnd > columnStart && cellEnd <= columnEnd) ||     // Overlaps column end
            (cellStart <= columnStart && cellEnd >= columnEnd)    // Fully spans the column
        );
    });
}

function setCursor(e, rect, rowIndex, rowRects, colIndex, isMerged) {
    const { x, width, y, height } = rect.getBBox();
    const buffer = 10;

    // Detect proximity to the edges of the current cell
    const nearRight = e.clientX >= x + width - buffer && e.clientX <= x + width;
    const nearBottom = e.clientY >= y + height - buffer && e.clientY <= y + height;
    const nearLeft = e.clientX >= x && e.clientX <= x + buffer;
    const nearTop = e.clientY >= y && e.clientY <= y + buffer;

    // Prevent overlap with adjacent cells
    const isInsideCell = e.clientX >= x && e.clientX <= x + width && e.clientY >= y && e.clientY <= y + height;

    if (!isInsideCell) {
        document.body.className = ""; // Default cursor if not inside the cell
        return;
    }

    // Handle cursor based on proximity to edges
    const nearCorner = nearRight && nearBottom;
    if (isMerged) {
        document.body.className = nearCorner
            ? "nw-resize"
            : nearRight
            ? "col-resize"
            : nearBottom
            ? "row-resize"
            : "";
    } else {
        document.body.className = nearCorner
            ? "nw-resize"
            : nearRight
            ? "col-resize"
            : nearBottom
            ? "row-resize"
            : "";
    }

    if (!nearCorner && !nearRight && !nearBottom && !nearLeft && !nearTop) {
        document.body.className = ""; // Default cursor if no conditions match
    }
}



function handleMouseDown(e, rect, rowRects, rowIndex, colIndex) {
    const { clientX: startX, clientY: startY } = e;
    const startWidth = +rect.getAttribute("width");
    const startHeight = +rect.getAttribute("height");
    const direction = getResizeDirection(e, rect);

    if (!direction) return;

    resizing = true;
    document.body.classList.add(direction);

    const onMouseMove = (e) => {
        const dx = Math.round((e.clientX - startX) / 10) * 10;
        const dy = Math.round((e.clientY - startY) / 10) * 10;

        if (direction.includes("col-resize")) {
            const newWidth = Math.max(startWidth + dx, 100);
            updateColumnWidth(rect, newWidth, rowRects, rowIndex, colIndex);
        }

        if (direction.includes("row-resize")) {
            const newHeight = Math.max(startHeight + dy, 100);
            updateRowHeight(rect, newHeight, rowRects, rowIndex);
        }
    };

    const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        resizing = false;
        document.body.classList.remove("col-resize", "row-resize", "nw-resize");
        saveGridState(rowRects);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
}

function getResizeDirection(e, rect) {
    const { left, width, top, height } = rect.getBoundingClientRect();
    const buffer = 15; // Adjust as needed

    if (e.clientX >= left + width - buffer && e.clientY >= top + height - buffer) return "nw-resize";
    if (e.clientX >= left + width - buffer) return "col-resize";
    if (e.clientY >= top + height - buffer) return "row-resize";
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

        // Check adjacency
        const isValidMerge = selectedRects.every((rect, i) => {
            const x = parseFloat(rect.getAttribute("x"));
            const y = parseFloat(rect.getAttribute("y"));
            const width = parseFloat(rect.getAttribute("width"));
            const height = parseFloat(rect.getAttribute("height"));

            return selectedRects.some((otherRect, j) => {
                if (i === j) return false;

                const otherX = parseFloat(otherRect.getAttribute("x"));
                const otherY = parseFloat(otherRect.getAttribute("y"));
                const otherWidth = parseFloat(otherRect.getAttribute("width"));
                const otherHeight = parseFloat(otherRect.getAttribute("height"));

                // Check if they share an edge
                const isHorizontallyAligned =
                    (x + width === otherX || otherX + otherWidth === x) && (y === otherY);
                const isVerticallyAligned =
                    (y + height === otherY || otherY + otherHeight === y) && (x === otherX);

                return isHorizontallyAligned || isVerticallyAligned;
            });
        });

        if (!isValidMerge) {
            console.warn("Cells are not adjacent and cannot be merged.");
            return;
        }

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

}

function redrawSVG() {
    document.getElementById("svg-container").innerHTML = "";
    createSVGLayout(originalData);
}

function saveGridState(rowRects, mergedCellsDetails = []) {
    const processedMergedRegions = new Set();

    const updatedLayout = {
        layout: {
            table: {
                row: rowRects.map((row, rowIndex) => ({
                    meta: { height: parseFloat(row[0]?.getAttribute("height")) || 0 },
                    column: row
                        .filter((col) => {
                            const mergedRegionId = col.getAttribute("data-merged-parent");
                            if (mergedRegionId && !processedMergedRegions.has(mergedRegionId)) {
                                const mergedCells = rowRects.flatMap((rRow, rRowIndex) =>
                                    rRow.filter((cell) =>
                                        cell.getAttribute("data-merged-parent") === mergedRegionId
                                    ).map((cell, colIndex) => ({
                                        id: cell.getAttribute("id"),
                                        rowIndex: rRowIndex,
                                        colIndex,
                                        meta: {
                                            width: parseFloat(cell.getAttribute("width")) || 0,
                                            height: parseFloat(cell.getAttribute("height")) || 0,
                                        },
                                    }))
                                );
                                mergedCellsDetails.push({
                                    id: mergedRegionId,
                                    x: parseFloat(col.getAttribute("x")),
                                    y: parseFloat(col.getAttribute("y")),
                                    width: parseFloat(col.getAttribute("width")) || 0,
                                    height: parseFloat(col.getAttribute("height")) || 0,
                                    children: mergedCells,
                                });
                                processedMergedRegions.add(mergedRegionId);
                                return false;
                            }
                            return true;
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
                mergedCells: mergedCellsDetails,
            },
        },
    };

    fetch("http://localhost:3000/grid.json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedLayout),
    })
        .then((response) => console.log(response.ok ? "Grid state saved successfully!" : "Failed to save grid state."))
        .catch((error) => console.error("Error saving grid state:", error));
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

        if (target.classList.contains("parent")) {
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
        if (!cellParts || cellParts.length < 3) return console.error("Invalid cell ID format:", cellId);

        const rowIndex = parseInt(cellParts[2]);
        const insertIndex = position === "above" ? rowIndex : rowIndex + 1;
        const refRow = originalData.layout.table.row[rowIndex];
        const refRowHeight = parseFloat(refRow.meta.height), newRowHeight = 100;
        saveState();

        for (let i = insertIndex; i < originalData.layout.table.row.length; i++) {
            const row = originalData.layout.table.row[i];
            row.meta.y += newRowHeight;
            row.column.forEach(cell => cell.meta.y += newRowHeight);
        }

        const newRow = {
            meta: { ...refRow.meta, y: position === "above" ? refRow.meta.y : refRow.meta.y + refRowHeight, height: newRowHeight },
            column: refRow.column.map(cell => ({
                ...cell,
                meta: { ...cell.meta, y: position === "above" ? cell.meta.y : cell.meta.y + refRowHeight, height: newRowHeight },
            })),
        };

        Object.values(mergedCellData).forEach(mergedCell => {
            if (mergedCell.y >= refRow.meta.y) {
                mergedCell.y += newRowHeight;
                mergedCell.height += newRowHeight;
            }
        });

        originalData.layout.table.row.splice(insertIndex, 0, newRow);
        redrawSVG();
        console.log(`Row added ${position} at index ${rowIndex}`);
    }

    function addColumn(cellId, position) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) return console.error("Invalid cell ID format:", cellId);

        const colIndex = parseInt(cellParts[1]);
        const insertIndex = position === "left" ? colIndex : colIndex + 1;
        saveState();

        Object.values(mergedCellData).forEach(mergedCell => {
            if (mergedCell.x >= colIndex * 100) {
                mergedCell.x += 100;
                mergedCell.width += 100;
            }
        });

        originalData.layout.table.row.forEach(row => {
            const refCell = row.column[colIndex];
            row.column.splice(insertIndex, 0, {
                ...refCell,
                meta: { ...refCell.meta, x: position === "left" ? refCell.meta.x : refCell.meta.x + refCell.meta.width, width: 100 },
            });
        });

        redrawSVG();
        console.log(`Column added ${position} at index ${colIndex}`);
    }

    function deleteRow(cellId) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) return console.error("Invalid cell ID format:", cellId);

        const rowIndex = parseInt(cellParts[2]);
        if (originalData.layout.table.row.length <= 1) return console.warn("Cannot delete the last remaining row.");

        saveState();


        mergeMap.forEach((originalCells, mergedRect) => {
            const mergedRowIndices = originalCells.map(cell => parseInt(cell.getAttribute("data-row-index")));
            const rowHeight = originalData.layout.table.row[rowIndex].meta.height;
            if (mergedRowIndices.includes(rowIndex)) mergedRect.setAttribute("height", parseFloat(mergedRect.getAttribute("height")) - rowHeight);
            else if (Math.min(...mergedRowIndices) > rowIndex) mergedRect.setAttribute("y", parseFloat(mergedRect.getAttribute("y")) - rowHeight);
        });

        originalData.layout.table.row.splice(rowIndex, 1);
        document.getElementById("svg-container").innerHTML = "";
        createSVGLayout(originalData);
        console.log(`Row deleted at index ${rowIndex}`);
    }

    function deleteColumn(cellId) {
        const cellParts = cellId.match(/cell_(\d+)_(\d+)/);
        if (!cellParts || cellParts.length < 3) return console.error("Invalid cell ID format:", cellId);

        const colIndex = parseInt(cellParts[1]);
        if (originalData.layout.table.row[0].column.length <= 1) return console.warn("Cannot delete the last remaining column.");

        saveState();

        originalData.layout.table.row.forEach(row => {
            mergeMap.forEach((originalCells, mergedRect) => {
                const mergedColIndices = originalCells.map(cell => parseInt(cell.getAttribute("data-col-index")));
                const colWidth = row.column[colIndex].meta.width;
                if (mergedColIndices.includes(colIndex)) mergedRect.setAttribute("width", parseFloat(mergedRect.getAttribute("width")) - colWidth);
                else if (Math.min(...mergedColIndices) > colIndex) mergedRect.setAttribute("x", parseFloat(mergedRect.getAttribute("x")) - colWidth);
            });
            row.column.splice(colIndex, 1);
        });

        document.getElementById("svg-container").innerHTML = "";
        createSVGLayout(originalData);
        console.log(`Column deleted at index ${colIndex}`);
    }

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
        container.removeEventListener("mousemove", drag);
        container.removeEventListener("mouseup", endDrag);
    };

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

    function createCloseButton(targetElement, cellId) {
        const closeButton = document.createElement("button");
        closeButton.textContent = "X";
        closeButton.style.position = "absolute";
        closeButton.style.display = "none"; // Initially hidden
        closeButton.style.zIndex = "1000";
        closeButton.style.cursor = "pointer";

        // Show the close button on hover
        targetElement.addEventListener("mouseenter", () => closeButton.style.display = "block");
        // targetElement.addEventListener("mouseleave", () => closeButton.style.display = "none");

        // Add event listener to close button to delete target element
        closeButton.addEventListener("click", () => {
            targetElement.remove();
            closeButton.remove();
            elementsMap.delete(cellId);
        });

        return closeButton;
    }

    function updateElementPosition(targetElement, referenceElement, closeButton) {
        const rect = referenceElement.getBoundingClientRect();
        Object.assign(targetElement.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });

        if (closeButton) {
            closeButton.style.left = `${rect.right - 20}px`;
            closeButton.style.top = `${rect.top}px`;
        }
    }

    function observeElementChanges(referenceElement, targetElement, closeButton) {
        const updatePosition = () => updateElementPosition(targetElement, referenceElement, closeButton);

        const observer = new MutationObserver(updatePosition);
        observer.observe(referenceElement, { attributes: true });

        const resizeObserver = new ResizeObserver(updatePosition);
        resizeObserver.observe(referenceElement);

        return { observer, resizeObserver };
    }

    function addText(cellId) {
        const cell = document.getElementById(cellId);

        const textBox = document.createElement("div");
        Object.assign(textBox, {
            id: `text_${cellId}`,
            className: "text-box",
            contentEditable: "true",
            placeholder: "Enter text..."
        });
        Object.assign(textBox.style, {
            position: "absolute",
            border: "1px solid #ccc",
            padding: "5px",
            boxSizing: "border-box",
            background: "white",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            overflowY: "scroll",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "flex-start"
        });

        const closeButton = createCloseButton(textBox, cellId);
        document.body.appendChild(textBox);
        document.body.appendChild(closeButton);

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

        const { observer, resizeObserver } = observeElementChanges(cell, textBox, closeButton);
        updateElementPosition(textBox, cell, closeButton);

        elementsMap.set(cellId, { element: textBox, closeButton, observer, resizeObserver });
        textBox.focus();
    }

    function uploadPhoto(cellId) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";

        input.addEventListener("change", function () {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    const cell = document.getElementById(cellId);
                    const img = document.createElement("img");
                    Object.assign(img, { src: e.target.result, id: `image_${cellId}` });
                    Object.assign(img.style, { position: "absolute" });

                    const closeButton = createCloseButton(img, cellId);
                    document.body.appendChild(img);
                    document.body.appendChild(closeButton);

                    const { observer, resizeObserver } = observeElementChanges(cell, img, closeButton);
                    updateElementPosition(img, cell, closeButton);

                    elementsMap.set(cellId, { element: img, closeButton, observer, resizeObserver });
                };
                reader.readAsDataURL(file);
            }
        });

        input.click();
    }

    const fontTypes = ["Arial", "Verdana", "Times New Roman", "Courier New", "Georgia"];
    const fontSizes = ["12px", "14px", "16px", "18px", "20px", "24px", "30px"];

    const populateDropdown = (dropdownId, options) => {
        const dropdown = document.getElementById(dropdownId);
        options.forEach(optionText => {
            const option = document.createElement("option");
            option.value = optionText;
            option.textContent = optionText;
            dropdown.appendChild(option);
        });
    };

    populateDropdown("font-type-dropdown", fontTypes);
    populateDropdown("font-size-dropdown", fontSizes);

    const applyStyle = (dropdownId, styleProperty) => {
        document.getElementById(dropdownId).addEventListener("change", (e) => {
            const textBox = document.querySelector(".text-box");
            if (textBox) textBox.style[styleProperty] = e.target.value;
        });
    };

    applyStyle("font-type-dropdown", "fontFamily");
    applyStyle("font-size-dropdown", "fontSize");
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
