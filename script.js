// --- Canvas and UI Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton'); // Get start button
const gameContainer = document.getElementById('game-container'); // Get container
const uiControls = document.getElementById('ui-controls');
const gravityControls = document.getElementById('gravity-controls');
const performanceSection = document.getElementById('performance-section');
const resetButton = document.getElementById('resetButton');
const messageElement = document.getElementById('message');
const gravitySlider = document.getElementById('gravitySlider');
const gravityValueSpan = document.getElementById('gravityValue');
// Performance Map Elements
const perfCanvas = document.getElementById('performanceCanvas');
const perfCtx = perfCanvas.getContext('2d');
const perfStatusElement = document.getElementById('perf-status');
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
    playerColor: '#0af',
    playerSmoothFactor: 0.15,
    asteroidRadius: 15,
    asteroidColor: '#aaa',
    // Adjust start position relative to new size if needed, or keep absolute
    asteroidStartX: () => config.canvasWidth / 2, // Keep centered horizontally
    asteroidStartY: () => config.canvasHeight - 150, // Keep relative distance from bottom
    asteroidTrailLength: 70,
    asteroidTrailColor: 'rgba(170, 170, 170, 0.5)',
    kickStrength: 1.0,
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
    // --- Performance Map ---
    perfMapAngles: 72,
    perfMapVelocities: 20,
    perfMapMaxVelocity: 15,
    perfMapMinVelocity: 1,
    perfMapSimSteps: 800,
    perfMapMaxDistColor: 400,
    perfMapHitLineColor: '#FFFFFF',
    perfMapMarkerColor: '#000000',
    perfMapMarkerRadius: 3,
    // --- Off-Screen Buffer for Simulation ---
    simOffScreenBuffer: 50, // How far off screen before simulation stops
    cursorResetBuffer: 10 // Extra pixels distance needed to reset

};

// --- Game State ---
let mouseX = config.canvasWidth / 2;
let mouseY = config.canvasHeight / 2;
let player;
let asteroid;
let planets = [];
let targetPlanet;
let stars = [];
let canKick = false; // Start as false initially
let gameActive = false; // Start as inactive
let animationFrameId = null;
let resetTimeoutId = null;
let needsCursorReset = false; // NEW: Flag for cursor reset requirement

// Performance Map State
let performanceData = null;
let isGeneratingPerfMap = false;
let lastKickAngle = null;
let lastKickVelocity = null;

// --- Planet Interaction State ---
let hoveredPlanet = null; // The planet the mouse is currently over
let draggedPlanet = null; // The planet currently being dragged
let isDraggingPlanet = false; // Flag to indicate dragging state

// --- Utility Functions ---
function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function interpolate(current, target, factor) {
    return current + (target - current) * factor;
}

// --- Game Objects (Classes Circle, Player, Asteroid, Planet) ---
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
class Asteroid extends Circle {
    constructor(x, y, radius, color) {
        super(x, y, radius, color); this.isMoving = false; this.trail = [];
    }
    addTrailPoint() {
        this.trail.push({ x: this.x, y: this.y }); if (this.trail.length > config.asteroidTrailLength) { this.trail.shift(); }
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
             context.textAlign = 'center'; context.fillText('TARGET', this.x, this.y - this.radius - 5);
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
    perfCanvas.width = config.canvasWidth; 
    perfCanvas.height = 200; 

    stars = [];
    for (let i = 0; i < config.starCount; i++) { stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, radius: Math.random() * 1.5, alpha: Math.random() * 0.5 + 0.2 }); }
    player = new Player(canvas.width / 2, canvas.height - 50, config.playerRadius, config.playerColor);
    asteroid = new Asteroid(config.asteroidStartX(), config.asteroidStartY(), config.asteroidRadius, config.asteroidColor);

    // --- Planets (Create ONLY if they don't exist yet) ---
    if (planets.length === 0) {
        console.log("Initializing planets for the first time.");
        planets = [
            new Planet(540.0, 392.6, 20, '#d9a443'),
            new Planet(897.0, 391.6, 35, '#43a0d9'),
            new Planet(703.0, 420.6, 25, '#d94343'),
            new Planet(600.0, 419.6, 25, '#d92313'),
            new Planet(799.0, 399.6, 25, '#888'),
            new Planet(696.0, 170.6, 65, '#0f8', true), // Target
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
    asteroid.isMoving = false; asteroid.vx = 0; asteroid.vy = 0; asteroid.trail = [];
    resetButton.disabled = true; // Disabled until asteroid is kicked
    player.x = mouseX; player.y = mouseY; player.prevX = mouseX; player.prevY = mouseY;
    hoveredPlanet = null; draggedPlanet = null; isDraggingPlanet = false;

    // --- Handle Cursor Reset State ---
    if (needsCursorReset) {
        canKick = false; // Must move cursor away first
        messageElement.textContent = 'Move cursor away from asteroid to begin.';
        messageElement.className = ''; // Neutral style
        console.log("Setup complete, waiting for cursor reset.");
    } else {
        canKick = true; // Allow kicking immediately
        messageElement.textContent = 'Move cursor to kick. Click/Drag planets to move, Wheel over planets to resize.';
        messageElement.className = '';
        console.log("Setup complete, ready to kick.");
    }

    if (!performanceData && !isGeneratingPerfMap) {
        triggerPerformanceMapGeneration("Initial generation...");
    } else if (performanceData) {
        drawPerformanceVisualization();
        drawTrialMarker();
    } else {
        drawPerformancePlaceholder("Generating...");
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
        const distCursorAsteroid = distance(mouseX, mouseY, asteroid.x, asteroid.y);
        // Check if cursor is outside the combined radii + buffer
        if (distCursorAsteroid > (config.playerRadius + asteroid.radius + config.cursorResetBuffer)) {
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

         if (!asteroid.isMoving) { // Check again if asteroid started moving somehow
            const distPlayerAsteroid = distance(player.x, player.y, asteroid.x, asteroid.y);
            if (distPlayerAsteroid < player.radius + asteroid.radius) {
                console.log("Kick triggered!");
                canKick = false; // Prevent immediate re-kick
                asteroid.isMoving = true;
                playSound('Start_3');
                const kickVx = player.vx * config.kickStrength;
                const kickVy = player.vy * config.kickStrength;
                asteroid.vx = kickVx;
                asteroid.vy = kickVy;
                lastKickVelocity = Math.sqrt(kickVx * kickVx + kickVy * kickVy);
                let angleRad = Math.atan2(-kickVy, kickVx);
                lastKickAngle = (angleRad * 180 / Math.PI + 360) % 360;
                messageElement.textContent = 'Asteroid launched!';
                resetButton.disabled = false; // Enable reset button NOW
                if (performanceData) {
                     drawPerformanceVisualization();
                     drawTrialMarker();
                }
            }
        }
    }

    // --- Asteroid Physics ---
    if (asteroid.isMoving) {
        let totalAccX = 0, totalAccY = 0;
        planets.forEach(planet => {
            const distAsteroidPlanet = distance(asteroid.x, asteroid.y, planet.x, planet.y);
            if (distAsteroidPlanet > asteroid.radius + planet.radius) {
                const forceDirX = planet.x - asteroid.x, forceDirY = planet.y - asteroid.y;
                const forceMagnitude = config.gravityConstant * planet.mass / (distAsteroidPlanet * distAsteroidPlanet);
                const accX = forceMagnitude * (forceDirX / distAsteroidPlanet), accY = forceMagnitude * (forceDirY / distAsteroidPlanet);
                totalAccX += accX; totalAccY += accY;
            }
        });
        asteroid.vx += totalAccX * config.timeStep;
        asteroid.vy += totalAccY * config.timeStep;
        asteroid.x += asteroid.vx * config.timeStep;
        asteroid.y += asteroid.vy * config.timeStep;
        asteroid.addTrailPoint();

        // --- Game End Conditions ---
        // Corrected Off-screen check using config dimensions
        if (asteroid.x < -asteroid.radius || asteroid.x > config.canvasWidth + asteroid.radius ||
            asteroid.y < -asteroid.radius || asteroid.y > config.canvasHeight + asteroid.radius) {
            endGame(false, 'Asteroid lost in space!'); return;
        }
        for (const planet of planets) {
            const distAsteroidPlanet = distance(asteroid.x, asteroid.y, planet.x, planet.y);
            if (distAsteroidPlanet < asteroid.radius + planet.radius) {
                if (planet.isTarget) { endGame(true, 'Target reached!'); }
                else { endGame(false, 'Hit the wrong planet!'); }
                return;
            }
        }
        if (targetPlanet) { // Check if targetPlanet exists
            const distToTarget = distance(asteroid.x, asteroid.y, targetPlanet.x, targetPlanet.y);
            if (distToTarget < asteroid.radius + targetPlanet.radius + config.successThreshold) {
                const dotProduct = (asteroid.x - targetPlanet.x) * asteroid.vx + (asteroid.y - targetPlanet.y) * asteroid.vy;
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
    planets.forEach(planet => planet.draw(ctx));
    if (asteroid.isMoving) { asteroid.drawTrail(ctx, config.asteroidTrailColor); }
    asteroid.draw(ctx);

    // Only draw player if they can kick (or are waiting for reset, to see where they are)
    // AND not dragging a planet
    if ((canKick || needsCursorReset) && !isDraggingPlanet) {
         player.draw(ctx);
    }
}

function endGame(success, msg) {
    if (!gameActive) return; // Prevent multiple calls
    console.log(`Game ended: ${success ? 'Success' : 'Failure'} - ${msg}`);
    gameActive = false; // Mark game as inactive
    canKick = false; // Disable kicking immediately
    messageElement.textContent = msg;
    messageElement.className = success ? 'success' : 'failure';
    resetButton.disabled = true; // Disable reset button during the brief pause


    // --- Play Appropriate End Sound ---
    if (success) {
        playSound('EndSuccess_1'); // Play the sequence for success
    } else {
        // Check the failure message to play the correct sound
        if (msg.includes('wrong planet')) {
            playSound('EndFail_1');
        } else if (msg.includes('lost in space')) {
            playSound('EndOutside');
        }
    }

    if (resetTimeoutId) clearTimeout(resetTimeoutId);
    resetTimeoutId = setTimeout(() => {
        resetTimeoutId = null;
        needsCursorReset = true; // !!! SET FLAG FOR NEXT AUTO-RESET !!!
        console.log("Auto-resetting trial, cursor reset required.");
        setup(); // Call setup, which will handle the needsCursorReset flag
    }, config.autoResetDelay);
}


function gameLoop() {
    update();
    draw();

    // Continue looping if game is active OR asteroid is moving OR waiting for cursor reset OR dragging planet
    if (gameActive || asteroid.isMoving || needsCursorReset || isDraggingPlanet) {
         animationFrameId = requestAnimationFrame(gameLoop);
    } else {
         console.log("Game loop stopping."); // Should only happen if game ended and reset timer hasn't fired yet
         animationFrameId = null; // Clear the ID
    }
}

// --- Performance Map Simulation ---

function simulateTrial(initialVx, initialVy) {
    let simAsteroid = {
        x: config.asteroidStartX(),
        y: config.asteroidStartY(),
        vx: initialVx * config.kickStrength,
        vy: initialVy * config.kickStrength,
        radius: config.asteroidRadius
    };

    // Calculate combined radii for efficiency ONLY IF targetPlanet exists
    const targetRadiiSum = targetPlanet ? simAsteroid.radius + targetPlanet.radius : 0;
    let minTargetSurfaceDist = Infinity; // Track distance to SURFACE

    // --- Initial State Checks ---
    // Check for immediate collision with non-target planets
    for (const planet of planets) {
        if (!planet.isTarget) {
            const distSimPlanetCheck = distance(simAsteroid.x, simAsteroid.y, planet.x, planet.y);
            if (distSimPlanetCheck <= simAsteroid.radius + planet.radius) {
                return Infinity; // FAIL: Starts inside a non-target planet
            }
        }
    }
    // Check for immediate collision with target planet
    if (targetPlanet) {
        const initialTargetDist = distance(simAsteroid.x, simAsteroid.y, targetPlanet.x, targetPlanet.y);
        if (initialTargetDist <= targetRadiiSum) {
            return 0; // SUCCESS: Starts inside target
        }
        minTargetSurfaceDist = initialTargetDist - targetRadiiSum; // Initial surface distance
    }


    // --- Simulation Loop ---
    for (let step = 0; step < config.perfMapSimSteps; step++) {

        // --- Calculate Gravity ---
        let totalAccX = 0, totalAccY = 0;
        planets.forEach(planet => {
            const distSimPlanetGrav = distance(simAsteroid.x, simAsteroid.y, planet.x, planet.y);
            // Check distance > 0 to avoid division by zero if somehow starting exactly at center
            if (distSimPlanetGrav > 0) {
                const forceDirX = planet.x - simAsteroid.x;
                const forceDirY = planet.y - simAsteroid.y;
                const distSq = distSimPlanetGrav * distSimPlanetGrav;
                const forceMagnitude = config.gravityConstant * planet.mass / distSq;
                // Apply acceleration only if outside the planet radius (standard physics)
                 if (distSimPlanetGrav > planet.radius){ // Optional: Prevents gravity pull from inside, consistent with game
                    const accX = forceMagnitude * (forceDirX / distSimPlanetGrav);
                    const accY = forceMagnitude * (forceDirY / distSimPlanetGrav);
                    totalAccX += accX;
                    totalAccY += accY;
                }
            }
        });

        // --- Update Velocity & Position ---
        simAsteroid.vx += totalAccX * config.timeStep;
        simAsteroid.vy += totalAccY * config.timeStep;
        simAsteroid.x += simAsteroid.vx * config.timeStep;
        simAsteroid.y += simAsteroid.vy * config.timeStep;

        // --- Collision Check AFTER movement ---
        let hitNonTarget = false;
        for (const planet of planets) {
             const distSimPlanetCheck = distance(simAsteroid.x, simAsteroid.y, planet.x, planet.y);
             const radiiSum = simAsteroid.radius + planet.radius; // Combined radii for this check

             if (distSimPlanetCheck <= radiiSum) {
                 if (planet.isTarget) {
                     // SUCCESS: Hit target - return 0 distance immediately
                     return 0; // Represents zero distance to surface
                 } else {
                     hitNonTarget = true; // Mark collision with non-target
                     break; // Exit planet loop
                 }
             }
        }
        if (hitNonTarget) return Infinity; // FAILURE: Hit wrong planet

        // --- Update Minimum Distance to Target Surface ---
        if (targetPlanet) {
            const currentTargetCenterDist = distance(simAsteroid.x, simAsteroid.y, targetPlanet.x, targetPlanet.y);
            const currentTargetSurfaceDist = currentTargetCenterDist - targetRadiiSum;
            minTargetSurfaceDist = Math.min(minTargetSurfaceDist, currentTargetSurfaceDist);
        } else {
            minTargetSurfaceDist = Infinity; // No target means infinite distance
        }

        // --- Check Off-screen AFTER movement & collision checks ---
        if (simAsteroid.x < -config.simOffScreenBuffer || simAsteroid.x > config.canvasWidth + config.simOffScreenBuffer ||
            simAsteroid.y < -config.simOffScreenBuffer || simAsteroid.y > config.canvasHeight + config.simOffScreenBuffer) {
            // Went off-screen. Return the minimum surface distance found *before* going off-screen.
            // If minTargetSurfaceDist <= 0, it means we hit/grazed target before going off, which counts as success (0).
             return (minTargetSurfaceDist <= 0) ? 0 : Infinity;
        }
    } // End simulation loop

    // Loop finished (max steps) without hitting non-target or going off-screen.
    // Return the closest approach to the target surface found.
    // If minTargetSurfaceDist is <= 0, it counts as a hit/graze, return 0.
    // Otherwise, return the positive minimum surface distance (capped for color mapping).
    if (!targetPlanet) return Infinity; // Should be caught earlier, but safety check

    if (minTargetSurfaceDist <= 0) {
        return 0; // Hit or grazed
    } else {
        // Return the positive surface distance, capped by the color threshold
        // We map color based on this positive distance.
        return Math.min(minTargetSurfaceDist, config.perfMapMaxDistColor * 1.5); // Cap prevents extreme values distorting color scale too much
    }
}

// --- Wrapper to trigger performance map generation ---
function triggerPerformanceMapGeneration(reason = "Recalculating map...") {
    if (isGeneratingPerfMap) {
       isGeneratingPerfMap = false; // Request cancellation of the ongoing generation
       perfStatusElement.textContent = `Map generation cancelled (${reason}). Regenerating...`;
       perfStatusElement.style.color = '#ff8c00'; // Orange for cancellation/restart
       // Give a brief moment for the async check inside generatePerformanceData to catch the cancellation
       setTimeout(() => {
           performanceData = null; // Invalidate old data immediately
           lastKickAngle = null;   // Reset marker state
           lastKickVelocity = null;
           generatePerformanceData(); // Start new generation
       }, 50); // Short delay
    } else {
        performanceData = null; // Invalidate old data
        lastKickAngle = null;   // Reset marker state
        lastKickVelocity = null;
        perfStatusElement.textContent = reason + " Generating...";
        perfStatusElement.style.color = '#ffcc00'; // Yellow for starting
        drawPerformancePlaceholder("Calculating..."); // Show placeholder immediately
        generatePerformanceData(); // Start generation
    }
}

// Generates the data for the performance map (asynchronously)
async function generatePerformanceData() {
    if (isGeneratingPerfMap) { // Should have been cancelled by trigger function, but double-check
        console.warn("generatePerformanceData called while already generating. Exiting.");
        return;
    }
    // Ensure target exists before starting generation
    if (!targetPlanet) {
        console.error("Cannot generate performance map: Target planet not found.");
        perfStatusElement.textContent = 'Error: Target planet missing.';
        perfStatusElement.style.color = '#f44';
        drawPerformancePlaceholder("Error: No Target");
        isGeneratingPerfMap = false; // Ensure flag is reset
        return;
    }

    isGeneratingPerfMap = true; // Set flag *after* initial checks
    // Status already set by trigger function

    const numAngles = config.perfMapAngles;
    const numVelocities = config.perfMapVelocities;
    const angleStep = 360 / numAngles;
    const velocityStep = (config.perfMapMaxVelocity - config.perfMapMinVelocity) / (numVelocities > 1 ? (numVelocities - 1) : 1);

    let data = Array(numVelocities).fill(null).map(() => Array(numAngles).fill(Infinity));
    let overallMin = Infinity, overallMax = 0;
    const totalSims = numAngles * numVelocities;
    let simsProcessed = 0;

    // --- Performance Map Generation Loop ---
    for (let j = 0; j < numVelocities; j++) {
        const velocity = config.perfMapMinVelocity + j * velocityStep;
        for (let i = 0; i < numAngles; i++) {
             // --- Check for cancellation request ---
             if (!isGeneratingPerfMap) {
                 console.log("Performance map generation cancelled.");
                 perfStatusElement.textContent = 'Map generation cancelled.';
                 perfStatusElement.style.color = '#ff8c00';
                 // Don't draw placeholder here, trigger function handles it
                 return; // Exit the generation loop
             }

            const angle = i * angleStep;
            const rad = angle * Math.PI / 180;
            const vx = velocity * Math.cos(rad);
            const vy = -velocity * Math.sin(rad);

            const minDist = simulateTrial(vx, vy);
            data[j][i] = minDist;

            if (isFinite(minDist)) {
                overallMin = Math.min(overallMin, minDist);
                overallMax = Math.max(overallMax, minDist);
            }

            simsProcessed++;
            if (simsProcessed % 100 === 0) { // Update status less frequently
                 perfStatusElement.textContent = `Generating map... (${((simsProcessed / totalSims) * 100).toFixed(0)}%)`;
                 await new Promise(resolve => setTimeout(resolve, 0)); // Yield control briefly
            }
        }
    }
    // --- End of Generation Loop ---

    // Check again if cancelled right at the end
     if (!isGeneratingPerfMap) {
          console.log("Performance map generation cancelled just before completion.");
          perfStatusElement.textContent = 'Map generation cancelled.';
          perfStatusElement.style.color = '#ff8c00';
          return;
     }


    performanceData = data; // Store the final data
    isGeneratingPerfMap = false; // Generation complete
    perfStatusElement.textContent = 'Performance map generated.';
    perfStatusElement.style.color = '#0f8'; // Green for success
    console.log(`Performance Map: Min finite dist=${overallMin.toFixed(2)}, Max finite dist=${overallMax.toFixed(2)}`);

    drawPerformanceVisualization();
    drawTrialMarker(); // Draw marker if there was a kick before generation finished
}

// Draws a placeholder on the performance canvas
function drawPerformancePlaceholder(text = "Calculating...") {
     perfCtx.fillStyle = '#222';
     perfCtx.fillRect(0, 0, perfCanvas.width, perfCanvas.height);
     perfCtx.fillStyle = '#aaa';
     perfCtx.font = '16px sans-serif';
     perfCtx.textAlign = 'center';
     perfCtx.fillText(text, perfCanvas.width / 2, perfCanvas.height / 2);
}


// Maps a distance value to an HSL color (Green=Good, Red=Bad)
function mapDistanceToColor(dist, maxDistThreshold = config.perfMapMaxDistColor) {
    // dist now represents minimum distance to target *surface*
    if (!isFinite(dist)) {
        return `hsl(0, 90%, 50%)`; // Red for failure (hit wrong planet / off-screen / no target)
    }
    if (dist <= 0) { // Hit or grazed the target surface
        return `hsl(120, 90%, 50%)`; // Bright Green for hit/graze
    }
    // If dist > 0, it's a miss. Normalize based on threshold.
    const normalized = Math.min(dist / maxDistThreshold, 1.0);

    // Hue: 120 (green) for 0 distance *away from surface*, down to 0 (red) for maxDistThreshold away
    // We want closer misses (small positive dist) to be yellower/greener than far misses.
    const hue = 120 * (1 - normalized); // Green (120) at dist=0, Red (0) at dist=threshold
    const saturation = 90;
    const lightness = 50;

    return `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;
}


function drawPerformanceVisualization() {
    if (!performanceData || !targetPlanet) {
        // If targetPlanet is missing, generatePerformanceData handles placeholder
        if (!targetPlanet) return;
        // Otherwise, data might just not be ready yet
        drawPerformancePlaceholder("No data available");
        return;
    };

    const data = performanceData;
    const numVelocities = data.length; if (numVelocities === 0) return;
    const numAngles = data[0].length; if (numAngles === 0) return;

    const cellWidth = perfCanvas.width / numAngles;
    const cellHeight = perfCanvas.height / numVelocities;
    const hitThreshold = 0; // Exact hit

    perfCtx.clearRect(0, 0, perfCanvas.width, perfCanvas.height);

    // 1. Draw Color Cells
    for (let j = 0; j < numVelocities; j++) {
        for (let i = 0; i < numAngles; i++) {
            const minDist = data[j][i];
            const color = mapDistanceToColor(minDist);
            const x = i * cellWidth;
            const y = perfCanvas.height - (j + 1) * cellHeight;
            perfCtx.fillStyle = color;
            perfCtx.fillRect(x, y, cellWidth + 1, cellHeight + 1); // Overlap slightly
        }
    }

    // 2. Draw Hit Boundary Lines
    perfCtx.strokeStyle = config.perfMapHitLineColor;
    perfCtx.lineWidth = 1.5;
    perfCtx.beginPath();
    for (let j = 0; j < numVelocities; j++) {
        for (let i = 0; i < numAngles; i++) {
            const isHit = data[j][i] === 0;
            if (!isHit) continue;

            const x = i * cellWidth;
            const y = perfCanvas.height - (j + 1) * cellHeight;

            // Check neighbors (handle wrap-around for angles)
            const rightIdx = (i + 1) % numAngles;
            if (data[j][rightIdx] > 0 || !isFinite(data[j][rightIdx])) { perfCtx.moveTo(x + cellWidth, y); perfCtx.lineTo(x + cellWidth, y + cellHeight); }
            const leftIdx = (i - 1 + numAngles) % numAngles;
            if (data[j][leftIdx] > 0 || !isFinite(data[j][leftIdx])) { perfCtx.moveTo(x, y); perfCtx.lineTo(x, y + cellHeight); }
            // Check vertical neighbors (no wrap-around for velocity)
            if (j > 0 && (data[j - 1][i] > 0 || !isFinite(data[j - 1][i]))){ perfCtx.moveTo(x, y); perfCtx.lineTo(x + cellWidth, y); }
             else if (j === 0) { perfCtx.moveTo(x, y); perfCtx.lineTo(x + cellWidth, y); } // Top edge boundary
             if (j < numVelocities - 1 && (data[j + 1][i] > 0 || !isFinite(data[j + 1][i]))){ perfCtx.moveTo(x, y + cellHeight); perfCtx.lineTo(x + cellWidth, y + cellHeight); }
             else if (j === numVelocities - 1) { perfCtx.moveTo(x, y + cellHeight); perfCtx.lineTo(x + cellWidth, y + cellHeight); } // Bottom edge boundary
        }
    }
    perfCtx.stroke();

    // 3. Draw Axis Labels
    perfCtx.fillStyle = '#DDD';
    perfCtx.font = '12px sans-serif';
    perfCtx.textAlign = 'center';
    perfCtx.fillText(`Kick Angle (0° to 360°)`, perfCanvas.width / 2, perfCanvas.height - 8);
    perfCtx.save();
    perfCtx.translate(15, perfCanvas.height / 2);
    perfCtx.rotate(-Math.PI / 2);
    perfCtx.textAlign = 'center';
    perfCtx.fillText(`Kick Velocity (${config.perfMapMinVelocity.toFixed(1)} to ${config.perfMapMaxVelocity.toFixed(1)} px/step)`, 0, 0);
    perfCtx.restore();
}

// Draws the trial marker
function drawTrialMarker() {
    if (lastKickAngle === null || lastKickVelocity === null || !performanceData) {
        return;
    }
    const clampedVelocity = Math.max(config.perfMapMinVelocity, Math.min(lastKickVelocity, config.perfMapMaxVelocity));
    const x = (lastKickAngle / 360) * perfCanvas.width;
    const velocityRange = config.perfMapMaxVelocity - config.perfMapMinVelocity;
    // Handle edge case where range is 0
    const normalizedVelocity = velocityRange > 0 ? (clampedVelocity - config.perfMapMinVelocity) / velocityRange : 0.5;
    const y = perfCanvas.height - (normalizedVelocity * perfCanvas.height);

    perfCtx.fillStyle = config.perfMapMarkerColor;
    perfCtx.beginPath();
    perfCtx.arc(x, y, config.perfMapMarkerRadius, 0, Math.PI * 2);
    perfCtx.fill();
    perfCtx.strokeStyle = '#FFFFFF';
    perfCtx.lineWidth = 0.5;
    perfCtx.stroke();
}

// --- Event Listeners ---

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Regenerate performance map debounced function
const debouncedTriggerPerfMapRegen = debounce((reason) => {
     triggerPerformanceMapGeneration(reason);
}, 1000); // 1 second debounce delay

// Main Canvas Mouse Move (Handles player targeting, hover detection)
canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;

    // --- Planet Dragging Logic ---
    if (isDraggingPlanet && draggedPlanet) {
        draggedPlanet.x = mouseX;
        draggedPlanet.y = mouseY;
        // Trigger regeneration *during* drag (debounced)
        debouncedTriggerPerfMapRegen("Planet moved...");
    }
    // Hover detection is handled in the update() loop for efficiency
});

// --- START BUTTON LISTENER ---
startButton.addEventListener('click', () => {
    console.log("Start button clicked, initializing game...");

    // Hide start button and overlay, show game elements
    startButton.style.display = 'none';
    gameContainer.classList.add('game-started'); // Removes overlay via CSS
    uiControls.style.display = 'flex';
    gravityControls.style.display = 'flex';
    performanceSection.style.display = 'block';

    // Ensure sounds are ready (should have been preloaded)
    // We might attempt to unlock audio context here if needed, though preloading helps
     // Example: Play a silent sound to potentially unlock context on some browsers
     // const silentSound = new Audio(); silentSound.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'; silentSound.play().catch(()=>{});

    // Initialize and start the game
    needsCursorReset = false; // No cursor reset needed on first start
    setup(); // This will now also start the game loop
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
        triggerPerformanceMapGeneration("Planet move finished...");
        // Allow kicking again AFTER a short delay to prevent immediate kick on mouseup
        setTimeout(() => { canKick = !asteroid.isMoving; }, 100);
    }
});

// Main Canvas Mouse Leave (Stop dragging if mouse leaves canvas)
canvas.addEventListener('mouseleave', (event) => {
     if (isDraggingPlanet) {
        isDraggingPlanet = false;
        draggedPlanet = null;
        canvas.style.cursor = 'default';
        triggerPerformanceMapGeneration("Planet move finished (mouse left)...");
        setTimeout(() => { canKick = !asteroid.isMoving; }, 100);
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
            debouncedTriggerPerfMapRegen("Planet resized..."); // Trigger regeneration (debounced)
        }
    }
});

resetButton.addEventListener('click', () => {
    console.log("Manual reset clicked.");
    if (resetTimeoutId) clearTimeout(resetTimeoutId); // Clear auto-reset timer
    resetTimeoutId = null;
    if (animationFrameId) cancelAnimationFrame(animationFrameId); // Stop current loop
    animationFrameId = null;

    // Stop potential ongoing map generation before reset
    if (isGeneratingPerfMap) {
        isGeneratingPerfMap = false; // Signal cancellation
        perfStatusElement.textContent = 'Resetting trial...';
        perfStatusElement.style.color = '#ccc';
    }

    needsCursorReset = false; // !!! MANUAL RESET: DO NOT require cursor move !!!
    setup(); // Restart the game setup and loop
});


gravitySlider.addEventListener('input', (event) => {
    const newGravity = parseFloat(event.target.value);
    config.gravityConstant = newGravity;
    gravityValueSpan.textContent = newGravity.toFixed(1);
    debouncedTriggerPerfMapRegen("Gravity changed..."); // Use the debounced trigger
});

// --- Initialization ---
gravitySlider.value = config.gravityConstant;
gravityValueSpan.textContent = config.gravityConstant.toFixed(1);

preloadSounds(); 
console.log("Game ready. Click 'Start Game' button.");
drawPerformancePlaceholder("Click Start Game");
perfStatusElement.textContent = "Waiting for game start...";
perfStatusElement.style.color = '#ccc';
