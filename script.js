// --- Canvas and UI Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton'); // Get start button
const gameContainer = document.getElementById('game-container'); // Get container
const uiControls = document.getElementById('ui-controls');
const gravityControls = document.getElementById('gravity-controls');
const resetButton = document.getElementById('resetButton');
const messageElement = document.getElementById('message');
const gravitySlider = document.getElementById('gravitySlider');
const gravityValueSpan = document.getElementById('gravityValue');
const performancePlotCanvas = document.getElementById("performancePlotCanvas");
const perfCtx = performancePlotCanvas.getContext('2d');
const generatePlotButton = document.getElementById('generatePlotButton');
const plotStatusElement = document.getElementById('plotStatus');


const soundAssetsPath = 'assets/';
const sounds = {};

// List of sound names (without extension)
const soundNames = [
    'Start_3.mp3',
    'EndSuccess_1.wav',
    'EndFail_1.wav',
    'EndOutside.mp3'
];

// --- Configuration ---
let config = {
    // --- Increased Canvas Size ---
    canvasWidth: 1400, // Increased width
    canvasHeight: 900, // Increased height
    starCount: 250, // Slightly more stars for bigger area
    playerRadius: 10,
    playerColor: '#fff',
    playerSmoothFactor: 0.15,
    resourceRadius: 15,
    resourceColor: '#2b82c9',
    resourceStartX: () => config.canvasWidth / 2, // Keep centered horizontally
    resourceStartY: () => config.canvasHeight - 150, // Keep relative distance from bottom
    resourceTrailLength: 70,
    resourceTrailColor: 'rgba(170, 170, 170, 0.5)',
    kickStrength: 0.5, // NOTE: Plot uses direct velocity, not kick strength
    gravityConstant: 5,
    planetMassFactor: 0.5,
    // --- Planet Interaction Config ---
    planetResizeStep: 2,
    planetMinRadius: 10,
    planetMaxRadius: 150,
    // --- End Game Config ---
    successThreshold: 0,
    timeStep: 1,
    autoResetDelay: 1500,
    // --- Off-Screen Buffer for Simulation ---
    simOffScreenBuffer: 50, // How far off screen before simulation stops
    cursorResetBuffer: 10, // Extra pixels distance needed to reset

    // --- Performance Map Configuration --- ADD THESE ---
    perfMapSize: 400, // Must match canvas width/height in HTML
    perfMapSimSteps: 500, // Max simulation steps per trial (adjust for performance)
    perfMapMinVel: 1, // Minimum velocity magnitude to plot
    perfMapMaxVel: 15, // Maximum velocity magnitude to plot
    perfMapVelSteps: 30, // Number of velocity increments (radius rings)
    perfMapAngleSteps: 72, // Number of angle increments (slices)
    perfMapMaxDistColor: 50 // Distance threshold for color mapping (pixels from surface)
    // -----------------------------------------------------
};
// --- Game State ---
let mouseX = config.canvasWidth / 2;
let mouseY = config.canvasHeight / 2;
let player;
let resource;
let planets = [];
let targetPlanet;
let stars = [];
let canKick = false; // Start as false initially
let gameActive = false; // Start as inactive
let animationFrameId = null;
let resetTimeoutId = null;
let needsCursorReset = false; // NEW: Flag for cursor reset requirement

// --- Planet Interaction State ---
let hoveredPlanet = null; // The planet the mouse is currently over
let draggedPlanet = null; // The planet currently being dragged
let isDraggingPlanet = false; // Flag to indicate dragging state

// --- Block and Trial State
const TRIALS_PER_BLOCK = 20;
let currentTrialInBlock = 1;
let currentBlockNumber = 1;
let totalScore = 0; // Optional: Track total successes across blocks
let blockSuccessCount = 0; // <<< NEW: Counter for successes in the current block
let isInBreak = false;
let breakCountdown = 10;
let breakTimerId = null;
let waitingForSpacebar = false;

let blockTrialMarkers = []; // Stores { velocity, angleRad } for successful kicks in block
let lastHeatmapImageData = null; // Stores the underlying heatmap image
let lastKickVelocity = 0; // Store last kick velocity magnitude here
let lastKickAngle = 0; // Store last kick angle (degrees or radians) here

// --- Utility Functions ---
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function interpolate(current, target, factor) {
    return current + (target - current) * factor;
}

// --- Game Objects (Classes Circle, Player, Resource, Planet) ---
class Circle {
    constructor(x, y, radius, color) {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.vx = 0; this.vy = 0;
    }
    draw(context) {
        context.beginPath(); context.arc(this.x, this.y, this.radius, 0, Math.PI * 2); context.fillStyle = this.color; context.fill();
    }
}
class Player extends Circle {
    constructor(x, y, radius, color) {
        super(x, y, radius, color); this.targetX = x; this.targetY = y; this.prevX = x; this.prevY = y;
    }
    update(targetX, targetY, smoothFactor) {
        this.prevX = this.x; this.prevY = this.y; this.x = interpolate(this.x, targetX, smoothFactor); this.y = interpolate(this.y, targetY, smoothFactor); this.vx = this.x - this.prevX; this.vy = this.y - this.prevY;
    }
}
class Resource extends Circle {
    constructor(x, y, radius, color) {
        super(x, y, radius, color); this.isMoving = false; this.trail = [];
    }
    addTrailPoint() {
        this.trail.push({ x: this.x, y: this.y }); if (this.trail.length > config.resourceTrailLength) { this.trail.shift(); }
    }
    drawTrail(context, trailColor) {
        if (this.trail.length < 2) return; context.beginPath(); context.moveTo(this.trail[0].x, this.trail[0].y); for (let i = 1; i < this.trail.length; i++) { const alpha = i / this.trail.length * 0.5; const baseColor = trailColor.substring(0, trailColor.lastIndexOf(',')); context.strokeStyle = `${baseColor}, ${alpha.toFixed(2)})`; const xc = (this.trail[i].x + this.trail[i - 1].x) / 2; const yc = (this.trail[i].y + this.trail[i - 1].y) / 2; context.quadraticCurveTo(this.trail[i - 1].x, this.trail[i - 1].y, xc, yc); } context.lineWidth = 2; context.stroke(); context.lineWidth = 1;
    }
}
class Planet extends Circle {
    constructor(x, y, radius, color, isTarget = false) {
        super(x, y, radius, color); this.isTarget = isTarget; this.mass = Math.PI * radius * radius * config.planetMassFactor;
    }
    recalculateMass() { this.mass = Math.PI * this.radius * this.radius * config.planetMassFactor; }
    draw(context) {
        // Draw hover/drag effect
        if (hoveredPlanet === this || draggedPlanet === this) {
            context.shadowBlur = 20;
            context.shadowColor = '#fff'; // White glow for interaction hint
        }
        super.draw(context);
        context.shadowBlur = 0; // Reset shadow

        // Draw target indicator
        if (this.isTarget) {
            context.shadowBlur = 15; context.shadowColor = this.color;
             context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke();
             context.shadowBlur = 0; context.lineWidth = 1;
             context.fillStyle = '#fff'; context.font = '12px sans-serif';
             context.textAlign = 'center'; context.fillText('Earth', this.x, this.y - this.radius - 5);
             context.textAlign = 'left';
        }
    }
}

// --- Event Listener for Printing Planet Info ---
window.addEventListener('keydown', (event) => {
    // Check if the pressed key is 'p' (lowercase or uppercase)
    if (event.key === 'p' || event.key === 'P') {
        console.log("--- Current Planet Configuration ---");
        if (planets && planets.length > 0) {
            planets.forEach((planet, index) => {
                // Format numbers for cleaner output (e.g., 1 decimal place)
                const xPos = planet.x.toFixed(1);
                const yPos = planet.y.toFixed(1);
                const radiusVal = planet.radius.toFixed(1);
                const targetStr = planet.isTarget ? " (TARGET)" : ""; // Indicate the target

                console.log(`Planet ${index}: Pos=(${xPos}, ${yPos}), Radius=${radiusVal}${targetStr}`);
            });
             // Optional: Also log the current gravity constant for context
             console.log(`Gravity Constant: ${config.gravityConstant.toFixed(1)}`);
        } else {
            console.log("No planets currently defined.");
        }
        console.log("----------------------------------");
    }
});

function preloadSounds() {
    console.log("Preloading sounds...");
    soundNames.forEach(name => {
        const audio = new Audio();
        audio.src = `${soundAssetsPath}${name}`;
        // Optional: you could add event listeners here to track loading progress
        // e.g., audio.addEventListener('canplaythrough', () => console.log(`${name} ready`));
        audio.addEventListener('error', (e) => {
            console.error(`Error loading sound "${name}":`, e);
        });
        // Browsers usually preload sufficiently when src is set, but load() can be explicit
        // audio.load(); // Often not strictly necessary, but doesn't hurt
        
        // Store without extension (remove last 4 characters)
        const nameWithoutExt = name.slice(0, -4);
        sounds[nameWithoutExt] = audio;
    });
    console.log("Sound preloading initiated.");
}

/**
 * Plays a preloaded sound file.
 * @param {string} soundName - The base name of the sound (e.g., 'Start_3')
 */
function playSound(soundName) {
    const audio = sounds[soundName];
    if (audio) {
        // Setting currentTime ensures the sound plays from the beginning
        // even if triggered again quickly before finishing.
        audio.currentTime = 0;
        audio.play().catch(error => {
            // Autoplay restrictions might prevent playing until first user interaction.
            console.warn(`Could not play sound "${soundName}":`, error);
            // You might want to buffer interactions until the user clicks something
            // if this becomes an issue on first load.
        });
    } else {
        console.error(`Sound "${soundName}" not found or not preloaded.`);
    }
}

// --- Game Logic ---

function setup() {
    if (resetTimeoutId) { clearTimeout(resetTimeoutId); resetTimeoutId = null; }
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }

    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;

    stars = [];
    for (let i = 0; i < config.starCount; i++) { stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, radius: Math.random() * 1.5, alpha: Math.random() * 0.5 + 0.2 }); }
    player = new Player(canvas.width / 2, canvas.height - 50, config.playerRadius, config.playerColor);
    resource = new Resource(config.resourceStartX(), config.resourceStartY(), config.resourceRadius, config.resourceColor);

    // --- Planets (Create ONLY if they don't exist yet) ---
    if (planets.length === 0) {
        console.log("Initializing planets for the first time.");
        planets = [
            new Planet(540.0, 392.6, 20, '#d9a443'),
            new Planet(897.0, 391.6, 35, '#0f8'),
            new Planet(703.0, 420.6, 25, '#d94343'),
            new Planet(600.0, 419.6, 25, '#d92313'),
            new Planet(799.0, 399.6, 25, '#888'),
            new Planet(696.0, 170.6, 85, '#2b82c9', true), // Target
        ];
        // Ensure masses are calculated on initial creation
        planets.forEach(p => p.recalculateMass());
    } else {
        console.log("Reusing existing planets.");
        // Planets array already exists, keep positions and sizes.
        // Mass should have been updated by interaction events, but recalculating here is safe.
        planets.forEach(p => p.recalculateMass());
    }

    // --- Target Planet Reference (Always update from current planets array) ---
    targetPlanet = planets.find(p => p.isTarget);
    if (!targetPlanet && planets.length > 0) {
        // Fallback: If no planet is marked as target (e.g., if target was deleted - future feature?)
        // For now, just log a warning. In a more robust system, you might assign one.
        console.warn("No target planet found in the existing planets array!");
        // Optionally, assign a default target here if needed:
        // planets[0].isTarget = true; // Assign the first one
        // targetPlanet = planets[0];
    } else if (planets.length === 0){
        console.error("CRITICAL: No planets defined or created!");
        // Handle this critical error state appropriately
    }

    // --- State Reset ---
    gameActive = true; // Game becomes active during setup
    resource.isMoving = false; resource.vx = 0; resource.vy = 0; resource.trail = [];
    resetButton.disabled = true; // Disabled until resource is kicked
    player.x = mouseX; player.y = mouseY; player.prevX = mouseX; player.prevY = mouseY;
    hoveredPlanet = null; draggedPlanet = null; isDraggingPlanet = false;

    // --- Handle Cursor Reset State ---
    if (needsCursorReset) {
        canKick = false; // Must move cursor away first
        messageElement.textContent = 'Move cursor away from resource to begin.';
        messageElement.className = ''; // Neutral style
        console.log("Setup complete, waiting for cursor reset.");
    } else {
        canKick = true; // Allow kicking immediately
        messageElement.textContent = 'Move cursor to kick. Click/Drag planets to move, Wheel over planets to resize.';
        messageElement.className = '';
        console.log("Setup complete, ready to kick.");
    }

    // --- Start the Game Loop ---
    // Ensure no duplicate loops are running
    if (animationFrameId) {
         cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(gameLoop); // Start the loop
}

function drawStarryBackground() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); stars.forEach(star => { ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`; ctx.fill(); });
}

function update() {
    // Stop updates if game is not active AND not waiting for cursor reset
    // If needsCursorReset is true, we still need updates to check cursor position
    if (!gameActive && !needsCursorReset) return;

    // --- Check for Cursor Reset Condition ---
    if (needsCursorReset) {
        const distCursorResource = distance(mouseX, mouseY, resource.x, resource.y);
        // Check if cursor is outside the combined radii + buffer
        if (distCursorResource > (config.playerRadius + resource.radius + config.cursorResetBuffer)) {
            needsCursorReset = false;
            canKick = true; // Enable kicking
            messageElement.textContent = 'Move cursor to kick. Click/Drag planets to move, Wheel over planets to resize.';
            console.log("Cursor reset condition met. Kicking enabled.");
        } else {
            // Keep player visually following the mouse even while waiting, but don't allow kick
             if (!isDraggingPlanet) {
                player.update(mouseX, mouseY, config.playerSmoothFactor);
             }
             // The game loop continues, but the kick logic below is skipped
        }
    }

    // --- Player & Kick Logic (only if kicking is allowed and not waiting for reset) ---
    if (canKick && !needsCursorReset && !isDraggingPlanet) {
        player.update(mouseX, mouseY, config.playerSmoothFactor);

        if (!resource.isMoving) { // Check again if resource started moving somehow
           const distPlayerResource = distance(player.x, player.y, resource.x, resource.y);
           if (distPlayerResource < player.radius + resource.radius) {
               console.log("Kick triggered!");
               canKick = false; // Prevent immediate re-kick
               resource.isMoving = true;
               playSound('Start_3');

               // Calculate ACTUAL initial velocity applied to resource
               const kickVx = player.vx * config.kickStrength;
               const kickVy = player.vy * config.kickStrength;

               // --- STORE KICK DATA ---
               lastKickVelocity = Math.sqrt(kickVx * kickVx + kickVy * kickVy);
               // Calculate angle (radians) from +X axis, accounting for canvas Y-down
               // atan2(y, x), but use -vy for standard math angle
               lastKickAngleRad = Math.atan2(-kickVy, kickVx);
               // Keep angle in 0 to 2*PI range if needed, although atan2 handles quadrants correctly
               if (lastKickAngleRad < 0) {
                   lastKickAngleRad += 2 * Math.PI;
               }
               // Also store degrees for potential display elsewhere if needed
               lastKickAngleDeg = lastKickAngleRad * 180 / Math.PI;
               // -----------------------

               resource.vx = kickVx;
               resource.vy = kickVy;

               messageElement.textContent = 'Resource launched!';
               resetButton.disabled = false; // Enable reset button NOW
           }
       }
   }

    // --- Resource Physics ---
    if (resource.isMoving) {
        let totalAccX = 0, totalAccY = 0;
        planets.forEach(planet => {
            const distResourcePlanet = distance(resource.x, resource.y, planet.x, planet.y);
            if (distResourcePlanet > resource.radius + planet.radius) {
                const forceDirX = planet.x - resource.x, forceDirY = planet.y - resource.y;
                const forceMagnitude = config.gravityConstant * planet.mass / (distResourcePlanet * distResourcePlanet);
                const accX = forceMagnitude * (forceDirX / distResourcePlanet), accY = forceMagnitude * (forceDirY / distResourcePlanet);
                totalAccX += accX; totalAccY += accY;
            }
        });
        resource.vx += totalAccX * config.timeStep;
        resource.vy += totalAccY * config.timeStep;
        resource.x += resource.vx * config.timeStep;
        resource.y += resource.vy * config.timeStep;
        resource.addTrailPoint();

        // --- Game End Conditions ---
        // Corrected Off-screen check using config dimensions
        if (resource.x < -resource.radius || resource.x > config.canvasWidth + resource.radius ||
            resource.y < -resource.radius || resource.y > config.canvasHeight + resource.radius) {
            endGame(false, 'Resource lost in space!'); return;
        }
        for (const planet of planets) {
            const distResourcePlanet = distance(resource.x, resource.y, planet.x, planet.y);
            if (distResourcePlanet < resource.radius + planet.radius) {
                if (planet.isTarget) { endGame(true, 'Target reached!'); }
                else { endGame(false, 'Hit the wrong planet!'); }
                return;
            }
        }
        if (targetPlanet) { // Check if targetPlanet exists
            const distToTarget = distance(resource.x, resource.y, targetPlanet.x, targetPlanet.y);
            if (distToTarget < resource.radius + targetPlanet.radius + config.successThreshold) {
                const dotProduct = (resource.x - targetPlanet.x) * resource.vx + (resource.y - targetPlanet.y) * resource.vy;
                if (dotProduct >= 0) {
                    endGame(true, 'Target grazed successfully!'); return;
                }
            }
        }
    }

    // --- Hover Detection (outside of physics update) ---
    // This happens even if game is not 'active' for interaction purposes
     if (!isDraggingPlanet) { // Don't check hover while dragging
        let foundHover = false;
        for (const planet of planets) {
            const distMousePlanet = distance(mouseX, mouseY, planet.x, planet.y);
            if (distMousePlanet <= planet.radius) {
                hoveredPlanet = planet;
                foundHover = true;
                break;
            }
        }
        if (!foundHover) {
            hoveredPlanet = null;
        }
    }
}

function draw() {
    drawStarryBackground();

    // Draw planets first
    planets.forEach(planet => planet.draw(ctx));

    // Draw resource and trail if moving
    if (resource.isMoving) {
        resource.drawTrail(ctx, config.resourceTrailColor);
    }
    resource.draw(ctx);

    // Draw player conditionally
    if ((canKick || needsCursorReset) && !isDraggingPlanet && !isInBreak) { // Don't draw player during break
         player.draw(ctx);
    }

    // --- Draw Trial/Block Info --- NEW ---
    drawTrialInfo();

    // --- Draw Break Overlay if in break --- NEW ---
    if (isInBreak) {
        drawBreakOverlay();
    }
}

function endGame(success, msg) {
    // Prevent duplicate calls if called again before reset timer fires
    if (!gameActive && !isInBreak) return;

    console.log(`Trial ${currentTrialInBlock}/${TRIALS_PER_BLOCK} (Block ${currentBlockNumber}) ended: ${success ? 'Success' : 'Failure'} - ${msg}`);
    gameActive = false;
    canKick = false;
    messageElement.textContent = msg;
    messageElement.className = success ? 'success' : 'failure';
    resetButton.disabled = true; // Disable reset until next setup

    // --- ADD MARKER DATA (Moved outside the 'if (success)' block) ---
    if (lastKickVelocity > 0) { // Only add if a valid kick was recorded
        blockTrialMarkers.push({
            velocity: lastKickVelocity,
            angleRad: lastKickAngleRad,
            success: success // Store the outcome
        });
        console.log(`Added marker: V=${lastKickVelocity.toFixed(2)}, A=${(lastKickAngleRad * 180 / Math.PI).toFixed(1)}°, Success=${success}`);
        // Trigger plot redraw AFTER adding data
        redrawPlotWithMarkers();
    } else if (!resource.isMoving) {
        // This case might happen if endGame is called unexpectedly before a kick
        console.warn("Trial ended, but resource was not moving (no kick data). Marker not added.");
    } else {
        // Kick happened, but velocity/angle somehow wasn't recorded? Should be rare.
         console.warn("Trial ended, but lastKickVelocity was 0. Marker not added.");
    }
    // Reset last kick info regardless of whether a marker was added
    lastKickVelocity = 0;
    lastKickAngleRad = 0;
    // ----------------------------------------------------------------

    // --- Handle Sounds and Score based on Success ---
    if (success) {
        totalScore++; // Optional total score
        blockSuccessCount++;
        playSound('EndSuccess_1');
    } else {
        // Failure sound logic...
        if (msg.includes('wrong planet')) {
            playSound('EndFail_1');
        } else if (msg.includes('lost in space')) {
            playSound('EndOutside');
        }
    }

    // --- Block Completion Logic ---
    if (currentTrialInBlock >= TRIALS_PER_BLOCK) {
        console.log(`Block ${currentBlockNumber} completed. Successes this block: ${blockSuccessCount}`);
        if (resetTimeoutId) clearTimeout(resetTimeoutId);
        resetTimeoutId = null;
        startBreak(); // Break automatically clears markers in startNextBlock
    } else {
        // --- NEXT TRIAL WITHIN BLOCK ---
        currentTrialInBlock++;
        if (resetTimeoutId) clearTimeout(resetTimeoutId);
        resetTimeoutId = setTimeout(() => {
            resetTimeoutId = null;
            needsCursorReset = true;
            console.log("Auto-resetting for next trial, cursor reset required.");
            setup(); // Setup resets canKick etc.
        }, config.autoResetDelay);
    }
}

function startBreak() {
    isInBreak = true;
    waitingForSpacebar = false; // Not waiting yet, countdown running
    breakCountdown = 10; // Reset countdown
    if (breakTimerId) clearInterval(breakTimerId); // Clear any previous timer

    console.log(`Starting 10 second break. Caught this block: ${blockSuccessCount}/${TRIALS_PER_BLOCK}`); // Added count to log

    // --- Update message to include score ---
    messageElement.textContent = `Block Complete! (Caught ${blockSuccessCount}/${TRIALS_PER_BLOCK}) Break: ${breakCountdown}s`;
    messageElement.className = ''; // Neutral style for break message

    // Disable interactions during break
    resetButton.disabled = true;
    gravitySlider.disabled = true;

    // Start the countdown timer
    breakTimerId = setInterval(updateBreakTimer, 1000);

    // Ensure the game loop continues for drawing the break overlay
    if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function updateBreakTimer() {
    breakCountdown--;
    if (breakCountdown > 0) {
        // --- Update countdown message to include score ---
        messageElement.textContent = `Block Complete! (Caught ${blockSuccessCount}/${TRIALS_PER_BLOCK}) Break: ${breakCountdown}s`;
    } else {
        // Countdown finished
        clearInterval(breakTimerId);
        breakTimerId = null;
        waitingForSpacebar = true; // Now waiting for spacebar

        // --- Update final message to include score ---
        messageElement.textContent = `Block Complete! (Caught ${blockSuccessCount}/${TRIALS_PER_BLOCK}) Press SPACEBAR!`;
        console.log("Break finished. Waiting for Spacebar.");
        // Re-enable controls if desired now, or wait until spacebar press
        // gravitySlider.disabled = false;
    }
    // The draw function will handle updating the canvas display using this text
}

function startNextBlock() {
    if (!isInBreak || !waitingForSpacebar) return;

    console.log("Spacebar pressed, starting next block.");
    isInBreak = false;
    waitingForSpacebar = false;

    currentBlockNumber++;
    currentTrialInBlock = 1;
    blockSuccessCount = 0;

    // --- CLEAR MARKERS ---
    blockTrialMarkers = [];
    // Trigger redraw to show empty plot (or just the heatmap if generated)
    redrawPlotWithMarkers();
    // -------------------

    // Re-enable controls
    resetButton.disabled = true; // Should be disabled until kick
    gravitySlider.disabled = false;

    messageElement.textContent = '';
    messageElement.className = '';

    needsCursorReset = false; // Start fresh, allow kick immediately if cursor ok
    setup(); // Setup handles initial message and canKick state
}

// --- START BUTTON LISTENER ---
startButton.addEventListener('click', () => {
    console.log("Start button clicked, initializing game...");

    // Hide start button and overlay, show game elements
    startButton.style.display = 'none';
    gameContainer.classList.add('game-started');
    uiControls.style.display = 'flex';
    gravityControls.style.display = 'flex';

    // Initialize Block/Trial State
    currentBlockNumber = 1;
    currentTrialInBlock = 1;
    totalScore = 0;
    blockSuccessCount = 0;
    isInBreak = false;
    waitingForSpacebar = false;
    if (breakTimerId) clearInterval(breakTimerId);

    // --- CLEAR MARKERS ON GAME START ---
    blockTrialMarkers = [];
    // Redraw plot (likely just shows placeholder or last heatmap without markers)
    redrawPlotWithMarkers();
    // -----------------------------------

    // Initialize and start the game
    needsCursorReset = false;
    setup();
});

function drawTrialInfo() {
    ctx.fillStyle = '#eee';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top'; // Set baseline to top for consistent positioning from Y

    const lineSpacing = 20; // Space between lines of text
    let currentY = 20; // Starting Y position

    ctx.fillText(`Block: ${currentBlockNumber}`, 20, currentY);
    currentY += lineSpacing; // Move down for the next line

    ctx.fillText(`Trial: ${currentTrialInBlock} / ${TRIALS_PER_BLOCK}`, 20, currentY);
    currentY += lineSpacing; // Move down

    // --- Display the new counter ---
    ctx.fillText(`Caught This Block: ${blockSuccessCount} / ${TRIALS_PER_BLOCK}`, 20, currentY);

    // Optional: Display total score
    // currentY += lineSpacing;
    // ctx.fillText(`Total Score: ${totalScore}`, 20, currentY);

    // Reset text alignment/baseline if needed for other drawing operations later
    // ctx.textAlign = 'left'; // Already left
    // ctx.textBaseline = 'alphabetic'; // Reset if necessary
}


// --- NEW Function to Draw Break Overlay ---
function drawBreakOverlay() {
    // Semi-transparent background overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Break Text Styling
    ctx.fillStyle = '#0f8'; // Use a prominent color
    ctx.font = 'bold 36px sans-serif'; // Slightly smaller font might be needed
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- Get the full message text ---
    const fullMessage = messageElement.textContent;

    // --- Split the message for potentially better layout ---
    // Example: Split at the first parenthesis or specific keyword like "Break" or "Press"
    let line1 = fullMessage;
    let line2 = "";

    // Try splitting based on common patterns in our messages
    const breakSplitIndex = fullMessage.indexOf(" Break:");
    const pressSplitIndex = fullMessage.indexOf(" Press SPACEBAR!");

    if (pressSplitIndex !== -1) {
        line1 = fullMessage.substring(0, pressSplitIndex).trim();
        line2 = "Press SPACEBAR!";
    } else if (breakSplitIndex !== -1) {
        line1 = fullMessage.substring(0, breakSplitIndex).trim();
        line2 = fullMessage.substring(breakSplitIndex).trim();
    }
    // If neither pattern matches, it will just draw line1 (the full message)

    // --- Draw the text lines ---
    const lineSpacing = 45; // Adjust as needed based on font size
    ctx.fillText(line1, canvas.width / 2, canvas.height / 2 - lineSpacing / 2);
    if (line2) {
        ctx.fillText(line2, canvas.width / 2, canvas.height / 2 + lineSpacing / 2);
    }


    // Reset text alignment/baseline if other drawings depend on it
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic'; // Or whatever the default is
}

function gameLoop() {
    if (!isInBreak) {
        update();
    } else {
        
    }
     
    draw();

    // Continue looping if game is active OR resource is moving OR waiting for cursor reset OR dragging planet OR IN BREAK
    if (gameActive || resource.isMoving || needsCursorReset || isDraggingPlanet || isInBreak) {
        animationFrameId = requestAnimationFrame(gameLoop);
   } else {
        console.log("Game loop stopping.");
        animationFrameId = null;
   }
}

// --- Performance Map Simulation ---

// --- Performance Map Simulation ---

// Modify simulateTrial to accept planets and targetPlanet
function simulateTrial(initialVx, initialVy, simPlanets, simTargetPlanet) {
    // If no target planet exists in the simulation scenario, return failure immediately
    if (!simTargetPlanet) {
        console.warn("SimulateTrial called without a target planet.");
        return Infinity; // No target means impossible to succeed
    }

    let simResource = {
        x: config.resourceStartX(),
        y: config.resourceStartY(),
        vx: initialVx,
        vy: initialVy,
        radius: config.resourceRadius
    };

    const targetRadiiSum = simResource.radius + simTargetPlanet.radius;
    let minTargetSurfaceDist = Infinity; // Track distance to SURFACE

    // --- Initial State Checks ---
    // Check for immediate collision with non-target planets
    for (const planet of simPlanets) {
        if (!planet.isTarget) {
            const distSimPlanetCheck = distance(simResource.x, simResource.y, planet.x, planet.y);
            if (distSimPlanetCheck <= simResource.radius + planet.radius) {
                return Infinity; // FAIL: Starts inside a non-target planet
            }
        }
    }
    // Check for immediate collision/start inside target planet
    const initialTargetDist = distance(simResource.x, simResource.y, simTargetPlanet.x, simTargetPlanet.y);
    if (initialTargetDist <= targetRadiiSum) {
        return 0; // SUCCESS: Starts inside target
    }
    minTargetSurfaceDist = initialTargetDist - targetRadiiSum; // Initial surface distance


    // --- Simulation Loop ---
    for (let step = 0; step < config.perfMapSimSteps; step++) {

        // --- Calculate Gravity ---
        let totalAccX = 0, totalAccY = 0;
        simPlanets.forEach(planet => {
            const distSimPlanetGrav = distance(simResource.x, simResource.y, planet.x, planet.y);
            if (distSimPlanetGrav > 0) { // Avoid division by zero
                const forceDirX = planet.x - simResource.x;
                const forceDirY = planet.y - simResource.y;
                const distSq = distSimPlanetGrav * distSimPlanetGrav;
                // Use the *current* game gravity constant for the simulation
                const forceMagnitude = config.gravityConstant * planet.mass / distSq;
                 // Apply acceleration only if outside the planet radius (standard physics)
                 if (distSimPlanetGrav > planet.radius){
                    const accX = forceMagnitude * (forceDirX / distSimPlanetGrav);
                    const accY = forceMagnitude * (forceDirY / distSimPlanetGrav);
                    totalAccX += accX;
                    totalAccY += accY;
                }
            }
        });

        // --- Update Velocity & Position ---
        simResource.vx += totalAccX * config.timeStep;
        simResource.vy += totalAccY * config.timeStep;
        simResource.x += simResource.vx * config.timeStep;
        simResource.y += simResource.vy * config.timeStep;

        // --- Collision Check AFTER movement ---
        let hitNonTarget = false;
        for (const planet of simPlanets) {
             const distSimPlanetCheck = distance(simResource.x, simResource.y, planet.x, planet.y);
             const radiiSum = simResource.radius + planet.radius;

             if (distSimPlanetCheck <= radiiSum) {
                 if (planet.isTarget) {
                     return 0; // SUCCESS: Hit target surface
                 } else {
                     hitNonTarget = true;
                     break; // Exit planet loop
                 }
             }
        }
        if (hitNonTarget) return Infinity; // FAILURE: Hit wrong planet

        // --- Update Minimum Distance to Target Surface ---
        const currentTargetCenterDist = distance(simResource.x, simResource.y, simTargetPlanet.x, simTargetPlanet.y);
        // Ensure distance calculation doesn't go negative if slightly inside due to discrete steps
        const currentTargetSurfaceDist = Math.max(0, currentTargetCenterDist - targetRadiiSum);
        minTargetSurfaceDist = Math.min(minTargetSurfaceDist, currentTargetSurfaceDist);

        // --- Check Off-screen AFTER movement & collision checks ---
        if (simResource.x < -config.simOffScreenBuffer || simResource.x > config.canvasWidth + config.simOffScreenBuffer ||
            simResource.y < -config.simOffScreenBuffer || simResource.y > config.canvasHeight + config.simOffScreenBuffer) {
            // Went off-screen. Return based on closest approach *before* going off-screen.
             return (minTargetSurfaceDist <= config.successThreshold) ? 0 : Infinity; // Use successThreshold here too
        }
    } // End simulation loop

    // Loop finished (max steps) without hitting non-target or going off-screen.
    // Return the closest approach. If it was within threshold, count as success (0).
    if (minTargetSurfaceDist <= config.successThreshold) {
        return 0; // Hit or grazed sufficiently close
    } else {
        // Return the positive surface distance, capped for color mapping.
        // Cap prevents extreme values distorting color scale too much
        return Math.min(minTargetSurfaceDist, config.perfMapMaxDistColor * 1.1);
    }
}

function mapVelocityToRadius(velocity, minVel, maxVel, maxPlotRadius) {
    if (velocity < minVel) return 0;
    if (velocity > maxVel) return maxPlotRadius;
    if (maxVel <= minVel) return 0; // Avoid division by zero

    const normalizedVel = (velocity - minVel) / (maxVel - minVel);
    return normalizedVel * maxPlotRadius;
}


// Maps a distance value to an HSL color (Green=Good, Red=Bad)
function mapDistanceToColor(dist, maxDistThreshold = config.perfMapMaxDistColor) {
    if (!isFinite(dist)) {
        return `hsl(0, 70%, 40%)`; // Darker Red for definite failure (hit wrong, off-screen)
    }
    // Success threshold check (using game config value)
    if (dist <= config.successThreshold) { // Use the same threshold as the game logic
        return `hsl(120, 90%, 50%)`; // Bright Green for hit/graze
    }
    // If dist > successThreshold, it's a miss. Normalize based on color threshold.
    // Clamp the distance used for normalization
    const clampedDist = Math.min(dist, maxDistThreshold);
    const normalized = clampedDist / maxDistThreshold; // Should be between 0 and 1

    // Hue: 120 (green) for near misses just outside threshold, down to 0 (red) for misses >= maxDistThreshold away
    const hue = 120 * (1 - normalized);
    const saturation = 90; // Keep saturation high
    const lightness = 50; // Keep lightness constant

    return `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;
}

function generatePerformancePlot() {
    console.log("Generating Performance Map...");
    generatePlotButton.disabled = true;
    plotStatusElement.textContent = 'Generating...';
    plotStatusElement.style.display = 'block';
    lastHeatmapImageData = null; // Clear previous heatmap data before generating new

    setTimeout(() => {
        const startTime = performance.now();
        const currentTargetPlanet = planets.find(p => p.isTarget);
        if (!currentTargetPlanet) {
            console.error("Cannot generate plot: No target planet found.");
            plotStatusElement.textContent = 'Error: No target planet!';
            setTimeout(() => { generatePlotButton.disabled = false; }, 1000);
            return;
        }
        const simPlanets = planets.map(p => new Planet(p.x, p.y, p.radius, p.color, p.isTarget));
        simPlanets.forEach(p => p.recalculateMass());
        const simTargetPlanet = simPlanets.find(p => p.isTarget);

        const plotSize = config.perfMapSize;
        const centerX = plotSize / 2;
        const centerY = plotSize / 2;
        const maxPlotRadius = plotSize / 2 * 0.9;

        perfCtx.fillStyle = '#222';
        perfCtx.fillRect(0, 0, plotSize, plotSize);
        perfCtx.lineWidth = 1;

        const angleStepRad = (2 * Math.PI) / config.perfMapAngleSteps;
        const velStep = (config.perfMapMaxVel - config.perfMapMinVel) / (config.perfMapVelSteps > 1 ? (config.perfMapVelSteps - 1) : 1); // Prevent div by zero if steps=1

        // --- Draw Heatmap Segments ---
        for (let i = 0; i < config.perfMapAngleSteps; i++) {
            const angle1 = i * angleStepRad;
            const angle2 = (i + 1) * angleStepRad;
            for (let j = 0; j < config.perfMapVelSteps; j++) {
                const vel1 = config.perfMapMinVel + j * velStep;
                const simVel = vel1 + velStep / 2;
                 if (simVel > config.perfMapMaxVel + 1e-6) continue;

                const radius1 = mapVelocityToRadius(vel1, config.perfMapMinVel, config.perfMapMaxVel, maxPlotRadius);
                const radius2 = mapVelocityToRadius(vel1 + velStep, config.perfMapMinVel, config.perfMapMaxVel, maxPlotRadius);

                const simAngle = angle1 + angleStepRad / 2;
                const initialVx = simVel * Math.cos(simAngle);
                const initialVy = simVel * -Math.sin(simAngle);

                const distanceResult = simulateTrial(initialVx, initialVy, simPlanets, simTargetPlanet);
                const color = mapDistanceToColor(distanceResult, config.perfMapMaxDistColor);

                perfCtx.beginPath();
                perfCtx.arc(centerX, centerY, radius2, -angle2, -angle1);
                perfCtx.arc(centerX, centerY, radius1, -angle1, -angle2, true);
                perfCtx.closePath();
                perfCtx.fillStyle = color;
                perfCtx.fill();
            }
        }

        // --- SAVE HEATMAP IMAGE DATA (Before drawing axes/markers) ---
        try {
            lastHeatmapImageData = perfCtx.getImageData(0, 0, plotSize, plotSize);
            console.log("Heatmap image data saved.");
        } catch (e) {
            console.error("Error getting ImageData (maybe canvas tainted?):", e);
            lastHeatmapImageData = null; // Ensure it's null if saving failed
            plotStatusElement.textContent = 'Error saving map data!';
        }
        // ------------------------------------------------------------

        // --- Redraw plot with axes and current markers ---
        redrawPlotWithMarkers(); // This now handles drawing axes and markers

        const endTime = performance.now();
        console.log(`Performance Map generated in ${(endTime - startTime).toFixed(1)} ms.`);
        plotStatusElement.textContent = `Generated (${(endTime - startTime).toFixed(0)} ms)`;
        setTimeout(() => {
            plotStatusElement.style.display = 'none';
            generatePlotButton.disabled = false;
        }, 2000);

    }, 10);
}

function drawPlotAxesAndLabels(pCtx, cX, cY, maxR) {
    pCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    pCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    pCtx.font = '10px sans-serif';
    pCtx.textAlign = 'center';
    pCtx.textBaseline = 'middle';

    // Draw concentric circles for velocity levels
    const numVelLabels = 4;
    for (let i = 1; i <= numVelLabels; i++) {
        const vel = config.perfMapMinVel + (i / numVelLabels) * (config.perfMapMaxVel - config.perfMapMinVel);
        const r = mapVelocityToRadius(vel, config.perfMapMinVel, config.perfMapMaxVel, maxR);
        pCtx.beginPath();
        pCtx.arc(cX, cY, r, 0, 2 * Math.PI);
        pCtx.stroke();
        // Add velocity label (e.g., along the 0 degree line)
        pCtx.fillText(vel.toFixed(1), cX + r, cY - 7);
    }

    // Draw radial lines for angles
    const numAngleLabels = 8; // e.g., every 45 degrees
    for (let i = 0; i < numAngleLabels; i++) {
        const angle = (i / numAngleLabels) * 2 * Math.PI;
        const endX = cX + maxR * Math.cos(angle);
        const endY = cY - maxR * Math.sin(angle); // Y negative
        pCtx.beginPath();
        pCtx.moveTo(cX, cY);
        pCtx.lineTo(endX, endY);
        pCtx.stroke();
        // Add angle label just outside the max radius
        const labelX = cX + (maxR + 15) * Math.cos(angle);
        const labelY = cY - (maxR + 15) * Math.sin(angle);
        pCtx.fillText(`${(angle * 180 / Math.PI).toFixed(0)}°`, labelX, labelY);
    }
     // Reset alignment
     pCtx.textAlign = 'start';
     pCtx.textBaseline = 'alphabetic';
}

function drawAllTrialMarkers(pCtx, cX, cY, maxR) {
    if (blockTrialMarkers.length === 0) return; // Nothing to draw

    const markerRadius = 4; // Size of the marker dot
    const lastIndex = blockTrialMarkers.length - 1;

    blockTrialMarkers.forEach((marker, index) => {
        // Map velocity to plot radius
        const plotR = mapVelocityToRadius(marker.velocity, config.perfMapMinVel, config.perfMapMaxVel, maxR);

        // Calculate marker position
        // angleRad is already stored correctly (0 = right, positive = counter-clockwise)
        // For canvas (Y down), plotY = cY - plotR * sin(angleRad)
        const plotX = cX + plotR * Math.cos(marker.angleRad);
        const plotY = cY - plotR * Math.sin(marker.angleRad); // Use MINUS sin for canvas Y-down

        // Determine color
        const isLast = (index === lastIndex);
        pCtx.fillStyle = isLast ? '#00aeff' : '#000000'; // Blue for last, Black for others
        pCtx.strokeStyle = isLast ? '#ffffff' : '#ffffff'; // White outline for visibility
        pCtx.lineWidth = 1;


        // Draw marker (e.g., a filled circle with outline)
        pCtx.beginPath();
        pCtx.arc(plotX, plotY, markerRadius, 0, Math.PI * 2);
        pCtx.fill();
        pCtx.stroke();
    });
     pCtx.lineWidth = 1; // Reset line width
}

function redrawPlotWithMarkers() {
    const plotSize = config.perfMapSize;
    const centerX = plotSize / 2;
    const centerY = plotSize / 2;
    const maxPlotRadius = plotSize / 2 * 0.9;

    if (lastHeatmapImageData) {
        // Restore the saved heatmap
        try {
             perfCtx.putImageData(lastHeatmapImageData, 0, 0);
        } catch (e) {
             console.error("Error putting ImageData:", e);
             // Fallback: clear and show error message?
             perfCtx.fillStyle = '#222';
             perfCtx.fillRect(0, 0, plotSize, plotSize);
             perfCtx.fillStyle = '#f55';
             perfCtx.textAlign = 'center';
             perfCtx.fillText('Error restoring map', centerX, centerY);
             return; // Stop further drawing
        }

    } else {
        // No heatmap generated yet, draw placeholder
        perfCtx.fillStyle = '#222';
        perfCtx.fillRect(0, 0, plotSize, plotSize);
        perfCtx.fillStyle = '#aaa';
        perfCtx.textAlign = 'center';
        perfCtx.font = '14px sans-serif';
        perfCtx.fillText('Generate map first', centerX, centerY);
        perfCtx.textAlign = 'start'; // Reset alignment
        // We can still try to draw markers even without a heatmap if needed,
        // but let's return here for now. Or draw axes? Let's draw axes.
         drawPlotAxesAndLabels(perfCtx, centerX, centerY, maxPlotRadius); // Draw axes even on placeholder
         drawAllTrialMarkers(perfCtx, centerX, centerY, maxPlotRadius); // Draw markers on placeholder
         return; // Exit after drawing placeholder, axes, markers
    }

    // Draw axes and labels ON TOP of the restored heatmap
    drawPlotAxesAndLabels(perfCtx, centerX, centerY, maxPlotRadius);

    // Draw all current trial markers ON TOP of heatmap and axes
    drawAllTrialMarkers(perfCtx, centerX, centerY, maxPlotRadius);

    console.log("Performance plot redrawn with markers.");
}


// --- Event Listeners ---


// Main Canvas Mouse Move (Handles player targeting, hover detection)
canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;

    // --- Planet Dragging Logic ---
    if (isDraggingPlanet && draggedPlanet) {
        draggedPlanet.x = mouseX;
        draggedPlanet.y = mouseY;

    }
    // Hover detection is handled in the update() loop for efficiency
});

// --- START BUTTON LISTENER ---
startButton.addEventListener('click', () => {
    console.log("Start button clicked, initializing game...");

    // Hide start button and overlay, show game elements
    startButton.style.display = 'none';
    gameContainer.classList.add('game-started');
    uiControls.style.display = 'flex';
    gravityControls.style.display = 'flex';

    // Initialize Block/Trial State
    currentBlockNumber = 1;
    currentTrialInBlock = 1;
    totalScore = 0;
    blockSuccessCount = 0; // <<< RESET counter on initial start
    isInBreak = false;
    waitingForSpacebar = false;
    if (breakTimerId) clearInterval(breakTimerId);

    // Initialize and start the game
    needsCursorReset = false;
    setup();
});

window.addEventListener('keydown', (event) => {
    // --- Existing 'P' key listener ---
    if (event.key === 'p' || event.key === 'P') {
        // ... (keep existing planet info logging code) ...
        console.log("--- Current Planet Configuration ---");
        // ... rest of 'p' key code ...
        console.log("----------------------------------");
    }

    // --- NEW Spacebar Listener for Breaks ---
    if (event.code === 'Space' && isInBreak && waitingForSpacebar) {
        event.preventDefault(); // Prevent default spacebar action (like scrolling)
        startNextBlock();
    }
});

// Main Canvas Mouse Down (Handles planet dragging start)
canvas.addEventListener('mousedown', (event) => {
    // Check if clicking on a planet
    for (const planet of planets) {
        const distMousePlanet = distance(mouseX, mouseY, planet.x, planet.y);
        if (distMousePlanet <= planet.radius) {
            isDraggingPlanet = true;
            draggedPlanet = planet;
            hoveredPlanet = null; // Stop hover effect while dragging
            canKick = false; // Prevent kicking while dragging
            canvas.style.cursor = 'grabbing'; // Change cursor
            return; // Found planet to drag, stop checking
        }
    }
});

// Main Canvas Mouse Up (Handles planet dragging end)
canvas.addEventListener('mouseup', (event) => {
    if (isDraggingPlanet) {
        isDraggingPlanet = false;
        draggedPlanet = null;
        canvas.style.cursor = 'default'; // Restore cursor
        // Final trigger for regeneration after drag ends
        // Allow kicking again AFTER a short delay to prevent immediate kick on mouseup
        setTimeout(() => { canKick = !resource.isMoving; }, 100);
    }
});

// Main Canvas Mouse Leave (Stop dragging if mouse leaves canvas)
canvas.addEventListener('mouseleave', (event) => {
     if (isDraggingPlanet) {
        isDraggingPlanet = false;
        draggedPlanet = null;
        canvas.style.cursor = 'default';
        setTimeout(() => { canKick = !resource.isMoving; }, 100);
    }
     hoveredPlanet = null; // Clear hover state when mouse leaves
});


// Main Canvas Wheel (Handles planet resizing)
canvas.addEventListener('wheel', (event) => {
    if (hoveredPlanet) {
        event.preventDefault(); // Prevent page scrolling

        const delta = Math.sign(event.deltaY); // -1 for wheel up (zoom in), 1 for wheel down (zoom out)
        let newRadius = hoveredPlanet.radius - delta * config.planetResizeStep;

        // Clamp radius
        newRadius = Math.max(config.planetMinRadius, Math.min(config.planetMaxRadius, newRadius));

        if (hoveredPlanet.radius !== newRadius) {
            hoveredPlanet.radius = newRadius;
            hoveredPlanet.recalculateMass(); // CRITICAL: Update mass
        }
    }
});

resetButton.addEventListener('click', () => {
    console.log("Manual reset clicked.");
    if (resetTimeoutId) clearTimeout(resetTimeoutId); // Clear auto-reset timer
    resetTimeoutId = null;
    if (animationFrameId) cancelAnimationFrame(animationFrameId); // Stop current loop
    animationFrameId = null;

    needsCursorReset = false; // !!! MANUAL RESET: DO NOT require cursor move !!!
    setup(); // Restart the game setup and loop
});

generatePlotButton.addEventListener('click', generatePerformancePlot);



gravitySlider.addEventListener('input', (event) => {
    const newGravity = parseFloat(event.target.value);
    config.gravityConstant = newGravity;
    gravityValueSpan.textContent = newGravity.toFixed(1);
});

// --- Initialization ---
gravitySlider.value = config.gravityConstant;
gravityValueSpan.textContent = config.gravityConstant.toFixed(1);

preloadSounds(); 
console.log("Game ready. Click 'Start Game' button.");
redrawPlotWithMarkers(); // Use the new function for initial draw too

// Optionally draw an initial empty state for the plot or prompt user to generate
perfCtx.fillStyle = '#222';
perfCtx.fillRect(0, 0, config.perfMapSize, config.perfMapSize);
perfCtx.fillStyle = '#aaa';
perfCtx.textAlign = 'center';
perfCtx.font = '14px sans-serif';
perfCtx.fillText('Click "Generate" button', config.perfMapSize / 2, config.perfMapSize / 2);
