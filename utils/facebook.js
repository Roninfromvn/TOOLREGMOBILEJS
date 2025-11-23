const axios = require('axios');

async function checkLiveUID(uid) {
    // URL Graph API chuẩn
    const url = `https://graph.facebook.com/${uid}/picture?redirect=0`;
    
    // Headers giả lập trình duyệt (Quan trọng)
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    };

    try {
        const response = await axios.get(url, { 
            headers: headers,
            timeout: 10000, // Timeout 10s
            validateStatus: () => true // Không throw lỗi nếu status != 200
        });

        if (response.status !== 200) {
            return "DIE";
        }

        const checkData = response.data;
        // Phòng trường hợp response không phải JSON
        if (typeof checkData !== 'object') return "DIE";

        const data = checkData.data || {};
        const imageUrl = data.url || "";

        // --- LOGIC MỚI (Port từ Python) ---

        // 1. Nếu URL trả về là link ảnh rác (static gif) -> DIE
        if (imageUrl.includes("static.xx.fbcdn.net")) {
            return "DIE";
        }

        // 2. Nếu thiếu chiều cao hoặc chiều rộng -> DIE
        if (!data.height || !data.width) {
            return "DIE";
        }

        // Nếu vượt qua hết -> LIVE
        return "LIVE";

    } catch (error) {
        // Bắt mọi lỗi mạng -> DIE
        return "DIE";
    }
}

module.exports = { checkLiveUID };