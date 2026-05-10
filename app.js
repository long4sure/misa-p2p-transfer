let peer = null;
let conn = null;
let selectedFiles = [];
const CHUNK_SIZE = 256 * 1024; 
const MAX_BUFFER = 16 * 1024 * 1024; 

// Performance & Tracking
let transferStartTime = 0;
let metricsInterval = null;
let wakeLock = null;
let html5QrCode = null;
let currentTransferBytes = 0; 
let receivedInSession = 0; 
let expectedInSession = 0; 
let isGracefulDisconnect = false; 
let unreadMessages = 0; // New: track unread MISA messages
// UI Elements
const myPeerIdDisplay = document.getElementById('my-peer-id');
const remotePeerIdInput = document.getElementById('remote-peer-id');
const connectBtn = document.getElementById('connect-btn');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name-display');

const sendProgressContainer = document.getElementById('send-progress-container');
const sendStatus = document.getElementById('send-status');
const sendProgressFill = document.getElementById('send-progress-fill');
const sendPercent = document.getElementById('send-percent');

const receiveProgressContainer = document.getElementById('receive-progress-container');
const receiveStatus = document.getElementById('receive-status');
const receiveProgressFill = document.getElementById('receive-progress-fill');
const receivePercent = document.getElementById('receive-percent');

// --- FORMAT BYTES ---
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- WAKE LOCK ---
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("Wake Lock Active");
        }
    } catch (err) { console.error(`${err.name}, ${err.message}`); }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// --- METRICS ---
function startMetrics(totalSize, type) {
    const speedEl = document.getElementById(`${type}-speed`);
    const etaEl = document.getElementById(`${type}-eta`);
    const metricsRow = document.getElementById(`${type}-metrics`);
    metricsRow.style.display = 'flex';
    
    transferStartTime = Date.now();
    lastBytesTransfered = 0;
    
    metricsInterval = setInterval(() => {
        const now = Date.now();
        const timeElapsed = (now - transferStartTime) / 1000;
        const currentBytes = type === 'send' ? currentTransferBytes : receivedSize;
        
        if (timeElapsed > 0) {
            const speed = currentBytes / timeElapsed; // bytes per second
            speedEl.innerText = `${formatBytes(speed)}/s`;
            
            const remaining = totalSize - currentBytes;
            if (speed > 0) {
                const eta = Math.ceil(remaining / speed);
                etaEl.innerText = eta > 60 ? `${Math.floor(eta/60)}m ${eta%60}s remaining` : `${eta}s remaining`;
            }
        }
    }, 1000);
}

function stopMetrics() {
    clearInterval(metricsInterval);
}

// --- PEER ID GENERATOR ---
function generateHumanId() {
    const adjectives = ["swift", "bold", "calm", "bright", "cool", "smart", "fast", "wild", "happy", "blue", "brave", "shiny", "silent", "gentle"];
    const nouns = ["panda", "tiger", "eagle", "river", "cloud", "star", "wave", "lion", "forest", "moon", "ocean", "mountain", "fox", "deer"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 99) + 1;
    return `${adj}-${noun}-${num}`;
}

// --- ROBUST COPY FUNCTION ---
function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    } else {
        let textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return new Promise((res, rej) => {
            document.execCommand('copy') ? res() : rej();
            document.body.removeChild(textArea);
        });
    }
}

function initPeer() {
    const customId = generateHumanId();
    peer = new Peer(customId);

    peer.on('open', (id) => {
        myPeerIdDisplay.innerText = id;
        myPeerIdDisplay.style.color = "var(--accent-color)";
    });

    peer.on('connection', (connection) => {
        if (conn && conn.open) {
            // Reject third-party connection attempts
            connection.on('open', () => {
                connection.send({ type: 'error', message: 'MISA: This sender is already busy with another device.' });
                setTimeout(() => connection.close(), 1000);
            });
            return;
        }
        
        conn = connection;
        setupConnectionHandlers();
        sendStatus.innerText = "Devices Connected!";
        sendProgressContainer.style.display = 'flex';
    });

    peer.on('error', (err) => {
        console.error("System Error:", err.type);
        if (err.type === 'peer-unavailable') {
            misaBroadcast("Hmm, I couldn't find that device. Could you double-check the Share Code for any typos?");
            alert("MISA here! I couldn't find a device with that code. Please double-check the spelling and try again!");
        }
    });
}

function setupConnectionHandlers() {
    conn.on('data', (data) => {
        if (data.type === 'request-files') {
            if (selectedFiles.length > 0) {
                sendAllFiles();
            } else {
                misaBroadcast("The receiver is ready! Please pick the videos you want to send.");
                sendStatus.innerText = "Device Connected! Now pick videos.";
                conn.send({ type: 'waiting-for-files' });
            }
        } else if (data.type === 'waiting-for-files') {
            receiveStatus.innerText = "Connected! Waiting for sender to pick videos...";
            misaBroadcast("I've linked the devices! Now just wait for the sender to choose their files.");
        } else if (data.type === 'disconnecting') {
            isGracefulDisconnect = true;
            misaBroadcast("The other device has ended the session. Connection closed gracefully.");
        } else if (data.type === 'file-info') {
            handleFileInfo(data);
        } else if (data.type === 'file-chunk') {
            handleIncomingChunk(data);
        }
    });
    conn.on('close', () => {
        if (!isGracefulDisconnect) {
            alert("Connection lost unexpectedly.");
        }
    });
}

// SENDER LOGIC
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFiles = Array.from(e.target.files);
        let totalSize = 0;
        selectedFiles.forEach(f => totalSize += f.size);
        fileNameDisplay.innerText = `${selectedFiles.length} video(s) ready - ${formatBytes(totalSize)}`;
        
        if (conn && conn.open) {
            misaBroadcast(`A device is already connected! I'll start sending these ${selectedFiles.length} videos now.`);
            sendAllFiles();
        } else {
            misaBroadcast(`Great! I'm ready to send those ${selectedFiles.length} videos. Just share your code or QR!`);
        }
    }
});

async function sendAllFiles() {
    if (selectedFiles.length === 0 || !conn) return;
    requestWakeLock();
    let totalSize = 0;
    selectedFiles.forEach(f => totalSize += f.size);
    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        currentTransferBytes = 0; // Reset for every new file
        startMetrics(file.size, 'send');
        await sendSingleFile(file, i + 1, selectedFiles.length);
        stopMetrics();
        logTransfer(file.name, file.size, 'sent');
        // Give the receiver a small breather between files
        if (i < selectedFiles.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    releaseWakeLock();
    sendStatus.innerText = "All videos sent!";
    document.getElementById('sender-next-steps').style.display = 'flex';
    misaBroadcast("Mission accomplished! All videos have been delivered safely.");
}

async function sendSingleFile(file, index, total) {
    return new Promise(async (resolve) => {
        conn.send({
            type: 'file-info',
            name: file.name,
            size: file.size,
            mime: file.type,
            index: index,
            total: total
        });

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        let chunksQueued = 0;
        let chunksFinished = 0;
        let offset = 0;

        const waitForBuffer = async () => {
            while (conn.dataChannel.bufferedAmount > MAX_BUFFER) {
                await new Promise(r => setTimeout(r, 50));
            }
        };

        while (offset < file.size) {
            await waitForBuffer();
            const blobChunk = file.slice(offset, offset + CHUNK_SIZE);
            const currentIdx = chunksQueued++; 
            
            const reader = new FileReader();
            reader.onload = (e) => {
                conn.send({ type: 'file-chunk', index: currentIdx, data: e.target.result });
                chunksFinished++;
                currentTransferBytes += blobChunk.size;
                
                if (chunksFinished % 4 === 0 || chunksFinished === totalChunks) {
                    const percent = Math.floor((chunksFinished / totalChunks) * 100);
                    sendProgressFill.style.width = percent + '%';
                    sendPercent.innerText = `${percent}%`;
                    sendStatus.innerText = `Sending Video ${index} of ${total}...`;
                }
                
                if (chunksFinished === totalChunks) resolve();
            };
            reader.readAsArrayBuffer(blobChunk);
            offset += CHUNK_SIZE;
        }
    });
}

// RECEIVER LOGIC
connectBtn.addEventListener('click', () => {
    const remoteId = remotePeerIdInput.value.trim();
    if (!remoteId) {
        misaBroadcast("I need a Share Code to start the search! Could you type it in for me?");
        return alert("Oops! You haven't entered a Share Code yet. Please type the code from the other device to begin.");
    }

    conn = peer.connect(remoteId, { reliable: true });
    receiveStatus.innerText = "Looking for sender...";
    receiveProgressContainer.style.display = 'flex';
    requestWakeLock();

    conn.on('open', () => {
        receiveStatus.innerText = "Connected! Receiving...";
        misaBroadcast("Connection established! I'm pulling the data through the wire now.");
        conn.send({ type: 'request-files' });
        setupConnectionHandlers();
    });
});

let receivedChunksMap = new Map();
let receivedSize = 0;
let totalSize = 0;
let currentFileName = "";
let currentFileMime = "";

function handleFileInfo(info) {
    receivedChunksMap = new Map();
    receivedSize = 0;
    totalSize = info.size;
    currentFileName = info.name;
    currentFileMime = info.mime;
    expectedInSession = info.total; // Store the total
    receiveStatus.innerText = `Receiving Video ${info.index} of ${info.total}...`;
    startMetrics(info.size, 'receive'); 
}

function handleIncomingChunk(chunk) {
    if (!receivedChunksMap.has(chunk.index)) {
        receivedChunksMap.set(chunk.index, chunk.data);
        receivedSize += chunk.data.byteLength;
    }

    if (receivedChunksMap.size % 10 === 0 || receivedSize >= totalSize) {
        const percent = Math.floor((receivedSize / totalSize) * 100);
        receiveProgressFill.style.width = percent + '%';
        receivePercent.innerText = `${percent}%`;
    }
    
    if (totalSize > 0 && receivedSize >= totalSize) {
        // Snapshot the current file data
        const fileSnapshot = {
            name: currentFileName,
            mime: currentFileMime,
            size: totalSize,
            chunks: []
        };
        for (let i = 0; i < receivedChunksMap.size; i++) {
            fileSnapshot.chunks.push(receivedChunksMap.get(i));
        }

        // Reset immediately for next file
        totalSize = 0;
        receivedSize = 0;
        receivedChunksMap = new Map();
        
        stopMetrics();
        releaseWakeLock();
        finalizeFile(fileSnapshot);
    }
}

function finalizeFile(file) {
    const blob = new Blob(file.chunks, { type: file.mime });
    const url = URL.createObjectURL(blob);
    
    const fileContainer = document.createElement('div');
    fileContainer.className = 'received-file-item';
    
    const title = document.createElement('h4');
    title.innerText = file.name;
    title.className = 'file-title';

    const sizeInfo = document.createElement('p');
    sizeInfo.innerText = formatBytes(file.size);
    sizeInfo.style.fontSize = '0.75rem';
    sizeInfo.style.opacity = '0.6';
    sizeInfo.style.textAlign = 'center';
    sizeInfo.style.marginBottom = '1rem';
    
    const vid = document.createElement('video');
    vid.src = url;
    vid.controls = true;
    vid.className = 'video-preview';
    vid.style.display = 'block';
    
    const actionGroup = document.createElement('div');
    actionGroup.className = 'action-group';

    const dl = document.createElement('a');
    dl.href = url;
    dl.download = file.name;
    dl.className = 'btn-simple';
    dl.innerText = `Save`;

    const del = document.createElement('button');
    del.className = 'btn-simple btn-simple-error';
    del.innerText = `Clear`;
    del.onclick = () => {
        URL.revokeObjectURL(url);
        fileContainer.remove();
    };
    
    actionGroup.appendChild(dl);
    actionGroup.appendChild(del);
    
    fileContainer.appendChild(title);
    fileContainer.appendChild(sizeInfo);
    fileContainer.appendChild(vid);
    fileContainer.appendChild(actionGroup);
    
    document.getElementById('received-files-list').prepend(fileContainer);
    receiveStatus.innerText = "Transfer Complete! Ready to Save";
    logTransfer(file.name, file.size, 'received');
    
    receivedInSession++;
    if (receivedInSession > 1) {
        document.getElementById('batch-actions').style.display = 'flex';
    }
    
    if (receivedInSession >= expectedInSession) {
        document.getElementById('receiver-next-steps').style.display = 'flex';
    }

    misaBroadcast(`The video "${file.name}" has arrived! Click "Save" to keep it.`);
}

function saveAllFiles() {
    const links = document.querySelectorAll('.received-file-item .btn-simple[download]');
    misaBroadcast(`I'm triggering downloads for all ${links.length} videos now!`);
    links.forEach((link, i) => {
        setTimeout(() => {
            link.click();
        }, i * 600);
    });
}

function clearAllFiles() {
    const clearBtns = document.querySelectorAll('.received-file-item .btn-simple-error');
    misaBroadcast(`Cleaning up memory... ${clearBtns.length} videos cleared.`);
    clearBtns.forEach(btn => btn.click());
    
    // Reset Progress UI
    receiveStatus.innerText = "Ready for new files";
    receivePercent.innerText = "0%";
    receiveProgressFill.style.width = "0%";
    document.getElementById('receive-metrics').style.display = 'none';
    
    document.getElementById('batch-actions').style.display = 'none';
    receivedInSession = 0;
}

async function resetSession() {
    if (conn && conn.open) {
        conn.send({ type: 'disconnecting' });
        // Tiny delay to ensure message is sent
        await new Promise(r => setTimeout(r, 100));
    }
    location.reload();
}

// --- HISTORY & QR & MISC ---
function logTransfer(name, size, type) {
    const history = JSON.parse(localStorage.getItem('misa_history') || '[]');
    history.unshift({ name, size, type, date: new Date().toLocaleString() });
    localStorage.setItem('misa_history', JSON.stringify(history.slice(0, 10))); // Keep last 10
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('misa_history') || '[]');
    const container = document.getElementById('history-section');
    const list = document.getElementById('history-list');
    
    if (history.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    list.innerHTML = history.map(item => `
        <div class="info-item" style="text-align:left; padding:1rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${item.name}</span>
                <span style="font-size:0.7rem; color:var(--accent-color); font-weight:800;">${item.type.toUpperCase()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:0.4rem; font-size:0.75rem; color:var(--text-secondary);">
                <span>${formatBytes(item.size)}</span>
                <span>${item.date.split(',')[0]}</span>
            </div>
        </div>
    `).join('');
}

function clearHistory() {
    localStorage.removeItem('misa_history');
    renderHistory();
}

function generateQR() {
    const id = myPeerIdDisplay.innerText;
    if (id === "Loading...") return;
    const container = document.getElementById('qr-container');
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
    
    if (container.style.display === 'block') {
        new QRious({
            element: document.getElementById('qr-code'),
            value: id,
            size: 200,
            background: 'white',
            foreground: 'black'
        });
    }
}

function startScanner() {
    const reader = document.getElementById('reader');
    reader.style.display = 'block';
    
    html5QrCode = new Html5Qrcode("reader");
    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        remotePeerIdInput.value = decodedText;
        html5QrCode.stop().then(() => {
            reader.style.display = 'none';
            connectBtn.click();
        });
    };
    
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback);
}

function misaBroadcast(text) {
    addChatMessage(text, 'bot-msg');
}

// UI TRANSITIONS
function showRole(role) {
    document.getElementById('selection-screen').style.display = 'none';
    if (role === 'sender') document.getElementById('sender-card').style.display = 'flex';
    else document.getElementById('receiver-card').style.display = 'flex';
}

function resetUI() {
    document.getElementById('selection-screen').style.display = 'grid';
    document.getElementById('sender-card').style.display = 'none';
    document.getElementById('receiver-card').style.display = 'none';
}

function toggleInfo(btn) {
    const item = btn.parentElement;
    const isExpanded = item.classList.contains('expanded');
    document.querySelectorAll('.info-item').forEach(i => i.classList.remove('expanded'));
    document.querySelectorAll('.learn-more').forEach(b => b.innerText = "Learn More");
    if (!isExpanded) {
        item.classList.add('expanded');
        btn.innerText = "Close";
    }
}

function toggleVersionModal() {
    const modal = document.getElementById('version-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

// CHATBOT LOGIC
function toggleChat() {
    const win = document.getElementById('chat-window');
    const isOpening = win.style.display === 'none' || win.style.display === '';
    win.style.display = isOpening ? 'flex' : 'none';
    
    if (isOpening) {
        unreadMessages = 0;
        const badge = document.getElementById('chat-badge');
        badge.style.display = 'none';
        badge.innerText = '';
    }
}

const botKnowledge = {
    "speed": "MISA uses every bit of your network speed by connecting your devices directly. No slow cloud uploads!",
    "private": "Yes, 100%. Your videos never touch a server. They move directly between your phones/computers.",
    "limit": "We recommend staying under 2GB per transfer to keep your device memory running smoothly.",
    "memory": "Videos are kept in your temporary phone memory. Tap 'Clear' after saving to free up space.",
    "connect": "On one device, click 'Send'. On the other, click 'Receive' and type in the Share Code.",
    "quality": "Bit-perfect quality. MISA sends the original file without any compression or changes.",
    "misa": "MISA stands for My Instant Sharing App. I am your personal assistant for fast and private video passing."
};

function handleChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.toLowerCase().trim();
    if (!msg) return;

    addChatMessage(input.value, 'user-msg');
    input.value = '';

    const thinkingId = 'thinking-' + Date.now();
    addChatMessage("MISA is thinking...", 'bot-msg', thinkingId);

    setTimeout(() => {
        document.getElementById(thinkingId).remove();
        let response = "I'm not sure, but I can help with 'speed', 'privacy', 'how to connect', or 'quality'!";
        for (let key in botKnowledge) {
            if (msg.includes(key)) {
                response = botKnowledge[key];
                break;
            }
        }
        addChatMessage(response, 'bot-msg');
    }, 800);
}

function addChatMessage(text, className, id = null) {
    const container = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = className;
    if (id) msgDiv.id = id;
    msgDiv.innerText = text;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;

    // Handle notification badge
    const win = document.getElementById('chat-window');
    if ((win.style.display === 'none' || win.style.display === '') && className === 'bot-msg') {
        unreadMessages++;
        const badge = document.getElementById('chat-badge');
        badge.innerText = unreadMessages;
        badge.style.display = 'flex';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('send-chat-btn').onclick = handleChat;
    document.getElementById('chat-input').onkeypress = (e) => { if (e.key === 'Enter') handleChat(); };
    document.getElementById('qr-gen-btn').onclick = generateQR;
    document.getElementById('scan-btn').onclick = startScanner;
    document.getElementById('save-all-btn').onclick = saveAllFiles;
    document.getElementById('clear-all-btn').onclick = clearAllFiles;
    
    renderHistory();

    document.getElementById('copy-btn').onclick = () => {
        const id = myPeerIdDisplay.innerText;
        if (id === "Loading...") return;
        copyToClipboard(id).then(() => {
            const btn = document.getElementById('copy-btn');
            btn.innerText = "Copied!";
            btn.style.background = "#22c55e";
            setTimeout(() => {
                btn.innerText = "Copy";
                btn.style.background = "";
            }, 2000);
        });
    };
});

initPeer();
