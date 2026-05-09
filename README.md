# MISA (My Instant Sharing App)

![Version](https://img.shields.io/badge/version-2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Privacy](https://img.shields.io/badge/privacy-100%25-brightgreen)

**MISA** is a high-performance, private, browser-to-browser media transfer tool. It allows users to pass large videos directly between devices with zero compression, zero server storage, and zero accounts.

## 💡 The Story Behind MISA
MISA was born out of a personal frustration: **"Storage Full."**

My phone is always packed with videos I don't want to delete, but I often found it inconvenient to move them to my old MacBook. Existing tools were slow, required accounts, or had compatibility issues with my older laptop.

I built MISA so I could quickly pass high-quality videos from my Android phone to my old Mac (and vice versa) without any extra configuration—just a simple browser-to-browser link. It's built for anyone who needs to move big files between different devices, instantly and privately.

## 🚀 What is MISA?
MISA stands for **My Instant Sharing App**. It utilizes WebRTC technology to turn your browser into a high-speed data node. Instead of uploading a video to the cloud and waiting to download it, MISA creates a direct "digital wire" between two devices, moving data at the maximum speed of your local network.

## 💎 Why use MISA?
*   **Absolute Privacy**: Your files never touch a server. They move directly from one RAM stick to another.
*   **True Quality**: We send raw data packets. There is zero compression, re-encoding, or "messing" with your pixels. 4K stays 4K.
*   **Limitless Speed**: Since there's no "middle-man," your transfer speed is only limited by your Wi-Fi or local cable connection.
*   **Zero Footprint**: No accounts, no cookies, and no trackers. Once you close the tab, the connection vanishes.

## 🛠 Technical Stack & Tools
*   **Architecture**: Serverless P2P (Peer-to-Peer). **Why:** This was chosen to eliminate central servers entirely, ensuring that your data is never stored or seen by a third party.
*   **Networking Protocol**: WebRTC via [PeerJS](https://peerjs.com/). **Why:** Used to handle the complex handshaking and secure data channels required for direct device-to-device communication.
*   **Frontend Engine**: Vanilla HTML5, CSS3, and ES6+ JavaScript. **Why:** Selected to ensure the application has zero-dependency bloat, resulting in ultra-fast performance and instant load times.
*   **Transmission Logic**: 256KB Binary Chunking with Active Flow Control. **Why:** Implemented to maximize network throughput while carefully monitoring the browser's buffer to prevent crashes.
*   **Typography**: [Outfit](https://fonts.google.com/specimen/Outfit). **Why:** Chosen to give the application a sleek, professional, and state-of-the-art tech aesthetic that stands out.
*   **Iconography**: Custom-coded SVG Icons. **Why:** Developed to avoid external library dependencies and ensure that every icon renders instantly with zero extra network requests.
*   **Memory Management**: Local System RAM reassembly. **Why:** Utilized to bypass slow physical disk writing (I/O) during the transfer, providing the fastest possible reassembly speed.
*   **Design Aesthetic**: High-fidelity Glassmorphism. **Why:** Implemented to provide a premium, modern user experience that feels responsive, alive, and professional.

## ⚠️ Limitations & Considerations
*   **RAM Limits**: Recommended batch limit of **2GB** per session. **Why:** Browsers have finite memory allocations; exceeding this can cause the tab to crash or become unresponsive.
*   **Browser Persistence**: The page must remain open on both devices. **Why:** Because WebRTC is a live, "real-time" connection, it cannot be resumed if the browser session is closed or killed.
*   **Network Compatibility**: Symmetric NATs may block some connections. **Why:** Strict firewalls sometimes block the direct "UDP" traffic used by P2P, requiring a TURN server for a workaround.
*   **Memory Cleanup**: Manual "Clear" action is required. **Why:** Browsers do not automatically delete large temporary blobs from memory, which could lead to "memory leaks" if not purged manually.

## 📖 How to Use
1.  **Sender**: Select "Send Video," pick your files, and copy the generated **Share Code**.
2.  **Receiver**: Select "Receive Video," paste the **Share Code**, and click "Connect."
3.  **Transfer**: Watch the real-time progress. Once complete, click "Save" to keep the video.
4.  **Cleanup**: Click "Clear" to wipe the video from your browser's memory and free up RAM.
