const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

let MAX_TAPS_GAME_SCORE; // This will be the game-winning score for a team
const GAME_PIN = 'a689475';
const TEAMS = ['red', 'blue', 'green', 'yellow'];
const TEAM_COLORS = {
    red: '#e74c3c',
    blue: '#3498db',
    green: '#2ecc71',
    yellow: '#f1c40f'
};

let teams = {};
let gameOver = false;

// Global tap rate limiting configuration
const GLOBAL_MAX_TAPS_PER_SECOND = 40;
const GLOBAL_TAP_WINDOW_MS = 1000; // 1 second

let globalTapCountInWindow = 0;
let lastGlobalTapWindowResetTime = Date.now();

// Timer to reset the global tap count periodically
let globalTapResetInterval;

function resetGlobalTapCounter() {
    globalTapCountInWindow = 0;
    lastGlobalTapWindowResetTime = Date.now();
    // console.log('Global tap count reset.'); // For debugging
}

// Set up a continuous interval to reset the global tap count
function startGlobalTapResetInterval() {
    if (globalTapResetInterval) {
        clearInterval(globalTapResetInterval);
    }
    globalTapResetInterval = setInterval(resetGlobalTapCounter, GLOBAL_TAP_WINDOW_MS);
}

// Stop the interval, useful if the server is shutting down or game is paused for a long time
function stopGlobalTapResetInterval() {
    if (globalTapResetInterval) {
        clearInterval(globalTapResetInterval);
        globalTapResetInterval = null;
    }
}


function resetTeams() {
    teams = {};
    gameOver = true;
    TEAMS.forEach(team => {
        teams[team] = {
            members: [],
            score: 0,
            color: TEAM_COLORS[team]
        };
    });
    // Stop global tap reset when game resets/is over
    stopGlobalTapResetInterval();
}

resetTeams(); // Initialize teams and stop global tap reset on server start

function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const ifaceName in interfaces) {
        const iface = interfaces[ifaceName];
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

const displayHost = getNetworkIP();

io.on('connection', (socket) => {
    console.log('New player connected or admin console loaded');

    const isClientPlayer = !socket.handshake.headers.referer || !socket.handshake.headers.referer.endsWith('index.html');

    if (isClientPlayer) {
        console.log(`Player client connected. Game over status: ${gameOver}`);

        // Player clients are assigned teams only when a game is not over
        if (!gameOver) {
            const assignedTeam = TEAMS.reduce((a, b) =>
                teams[a].members.length <= teams[b].members.length ? a : b
            );
            if (teams[assignedTeam]) {
                teams[assignedTeam].members.push(socket.id);
                socket.team = assignedTeam;
                socket.emit('assignedTeam', assignedTeam);
                // No gameStarted emit here, it's sent after countdown from admin
                io.emit('updateScores', teams); 
            }
        } else {
            console.log('Game not active. Player will wait for game to start.');
            // Even if game is over, they get assigned a team if they connect.
            // This needs to be handled: maybe they get assigned a "spectator" team
            // or just wait for 'gameReset' and 'gameStarted' events.
            // For now, they'll just wait for game start/reset, which will assign a team.
        }
    } else {
        // This is likely the admin console
        socket.emit('requestPin');
    }
    
    // Always send initial scores to new connections
    io.emit('updateScores', teams);

    socket.on('startGame', (pin, newMaxTaps) => {
        if (pin === GAME_PIN) {
            const parsedTaps = parseInt(newMaxTaps);
            MAX_TAPS_GAME_SCORE = isNaN(parsedTaps) || parsedTaps <= 0 ? 100 : parsedTaps; // Game-winning score

            Object.keys(teams).forEach(team => {
                teams[team].score = 0;
            });
            gameOver = false;
            
            // Re-assign players to teams for the new game, clearing old assignments
            // This is crucial to ensure clean slate for a new game.
            TEAMS.forEach(teamName => {
                teams[teamName].members = []; 
            });

            // Re-assign all *connected* player sockets
            io.sockets.sockets.forEach((s) => {
                // Check if it's a player client (not admin console)
                if (!s.handshake.headers.referer || !s.handshake.headers.referer.endsWith('index.html')) {
                    const assignedTeam = TEAMS.reduce((a, b) =>
                        teams[a].members.length <= teams[b].members.length ? a : b
                    );
                    if (teams[assignedTeam]) {
                        teams[assignedTeam].members.push(s.id);
                        s.team = assignedTeam; // Store team on socket object
                        s.emit('assignedTeam', assignedTeam); // Tell player their team
                    }
                }
            });

            io.emit('updateScores', teams);

            let countdown = 3;
            const countdownInterval = setInterval(() => {
                io.emit('countdown', countdown);
                countdown--;
                if (countdown < 0) {
                    clearInterval(countdownInterval);
                    io.emit('gameStarted');
                    io.emit('updateScores', teams);
                    startGlobalTapResetInterval(); // Start the global tap counter reset when game starts
                }
            }, 1000);
        } else {
            socket.emit('invalidPin'); // Admin client receives this
        }
    });

    socket.on('tap', () => {
        // console.log(`Tap received from ${socket.id}, team: ${socket.team}`); // Debugging tap reception
        if (gameOver || !socket.team || !teams[socket.team]) {
            // console.log('Tap rejected: Game over or no team assigned.'); // Debugging tap rejection
            return;
        }

        // Global Rate Limiting Check
        const now = Date.now();

        // This check is redundant if we have a periodic reset, but good as a fail-safe
        if (now - lastGlobalTapWindowResetTime >= GLOBAL_TAP_WINDOW_MS) {
            resetGlobalTapCounter(); // Ensure it's reset if interval was missed or just started
        }

        if (globalTapCountInWindow < GLOBAL_MAX_TAPS_PER_SECOND) {
            const team = teams[socket.team];
            team.score++;
            globalTapCountInWindow++;
            io.emit('updateScores', teams);

            // console.log(`Tap accepted. Global count: ${globalTapCountInWindow}`); // Debugging accepted taps

            if (MAX_TAPS_GAME_SCORE && team.score >= MAX_TAPS_GAME_SCORE) {
                gameOver = true;
                announceWinner(socket.team);
                stopGlobalTapResetInterval(); // Stop global tap reset when game ends
            }
        } else {
            // console.log(`Tap rejected from ${socket.id}: Global tap limit of ${GLOBAL_MAX_TAPS_PER_SECOND} reached.`); // Debugging rejected taps
            // Optionally, emit an event back to the client to inform them their tap was rejected
            // socket.emit('tapRejected', 'Server busy with too many taps!');
        }
    });

    socket.on('resetGame', () => {
        console.log('Game reset requested');
        resetTeams(); // This will also call stopGlobalTapResetInterval()
        io.emit('updateScores', teams);
        io.emit('gameReset');
    });
    
    socket.on('requestTeam', () => {
        // This is typically for new players connecting or reconnecting
        if (!gameOver) {
            const assignedTeam = TEAMS.reduce((a, b) =>
                teams[a].members.length < teams[b].members.length ? a : b
            );
            if (teams[assignedTeam]) {
                if (socket.team && teams[socket.team]) {
                    // Remove from old team if already assigned (e.g., reconnect)
                    teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
                }
                teams[assignedTeam].members.push(socket.id);
                socket.team = assignedTeam;
                socket.emit('assignedTeam', assignedTeam);
                io.emit('updateScores', teams);
                // No gameStarted emit here, gameStarted is sent by admin
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (socket.team && teams[socket.team]) {
            teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
            io.emit('updateScores', teams);
        }
    });
});

function announceWinner(winningTeam) {
    io.emit('gameOver', winningTeam);
}

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`Access at: http://${displayHost}:${port}/`);
    console.log(`Admin console typically at: http://${displayHost}:${port}/index.html`);
    console.log(`Player client page: http://${displayHost}:${port}/client.html`);
});