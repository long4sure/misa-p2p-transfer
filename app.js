let peer = null;
let conn = null;
let selectedFiles = [];
const CHUNK_SIZE = 256 * 1024; 
const MAX_BUFFER = 16 * 1024 * 1024; 

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
        conn = connection;
        setupConnectionHandlers();
        sendStatus.innerText = "Devices Connected!";
        sendProgressContainer.style.display = 'flex';
    });

    peer.on('error', (err) => {
        console.error("System Error:", err.type);
        if (err.type === 'peer-unavailable') {
            alert("Share Code not found. Please check for typos.");
        }
    });
}

function setupConnectionHandlers() {
    conn.on('data', (data) => {
        if (data.type === 'request-files') {
            if (selectedFiles.length > 0) {
                sendAllFiles();
            } else {
                conn.send({ type: 'error', message: 'No videos picked' });
            }
        } else if (data.type === 'file-info') {
            handleFileInfo(data);
        } else if (data.type === 'file-chunk') {
            handleIncomingChunk(data);
        }
    });
    conn.on('close', () => alert("Connection lost."));
}

// SENDER LOGIC
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFiles = Array.from(e.target.files);
        let totalSize = 0;
        selectedFiles.forEach(f => totalSize += f.size);
        fileNameDisplay.innerText = `${selectedFiles.length} video(s) ready - ${formatBytes(totalSize)}`;
    }
});

async function sendAllFiles() {
    if (selectedFiles.length === 0 || !conn) return;
    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        await sendSingleFile(file, i + 1, selectedFiles.length);
    }
    sendStatus.innerText = "All videos sent!";
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
        let chunksSent = 0;
        let offset = 0;

        const waitForBuffer = async () => {
            while (conn.dataChannel.bufferedAmount > MAX_BUFFER) {
                await new Promise(r => setTimeout(r, 50));
            }
        };

        while (offset < file.size) {
            await waitForBuffer();
            const blobChunk = file.slice(offset, offset + CHUNK_SIZE);
            const currentIdx = chunksSent;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                conn.send({ type: 'file-chunk', index: currentIdx, data: e.target.result });
                chunksSent++;
                
                if (chunksSent % 4 === 0 || chunksSent === totalChunks) {
                    const percent = Math.floor((chunksSent / totalChunks) * 100);
                    sendProgressFill.style.width = percent + '%';
                    sendPercent.innerText = `${percent}%`;
                    sendStatus.innerText = `Sending Video ${index} of ${total}...`;
                }
                
                if (chunksSent === totalChunks) resolve();
            };
            reader.readAsArrayBuffer(blobChunk);
            offset += CHUNK_SIZE;
            chunksSent++; 
        }
    });
}

// RECEIVER LOGIC
connectBtn.addEventListener('click', () => {
    const remoteId = remotePeerIdInput.value.trim();
    if (!remoteId) return alert("Please type a Share Code.");

    conn = peer.connect(remoteId, { reliable: true });
    receiveStatus.innerText = "Looking for sender...";
    receiveProgressContainer.style.display = 'flex';

    conn.on('open', () => {
        receiveStatus.innerText = "Connected! Receiving...";
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
    receiveStatus.innerText = `Receiving Video ${info.index} of ${info.total}...`;
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
    
    if (receivedSize >= totalSize) finalizeFile();
}

function finalizeFile() {
    const sortedChunks = [];
    for (let i = 0; i < receivedChunksMap.size; i++) sortedChunks.push(receivedChunksMap.get(i));

    const blob = new Blob(sortedChunks, { type: currentFileMime });
    const url = URL.createObjectURL(blob);
    
    const fileContainer = document.createElement('div');
    fileContainer.className = 'received-file-item';
    
    const title = document.createElement('h4');
    title.innerText = currentFileName;
    title.className = 'file-title';

    const sizeInfo = document.createElement('p');
    sizeInfo.innerText = formatBytes(blob.size);
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
    dl.download = currentFileName;
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
    
    document.getElementById('receiver-card').appendChild(fileContainer);
    receiveStatus.innerText = "Video Saved Successfully!";
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

// CHATBOT LOGIC
function toggleChat() {
    const win = document.getElementById('chat-window');
    win.style.display = win.style.display === 'none' ? 'flex' : 'none';
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
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('send-chat-btn').onclick = handleChat;
    document.getElementById('chat-input').onkeypress = (e) => { if (e.key === 'Enter') handleChat(); };
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
