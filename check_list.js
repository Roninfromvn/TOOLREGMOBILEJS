const axios = require('axios');

// Cấu hình giống file settings.yaml cũ của bạn
const BASE_URL = "http://127.0.0.1:53200"; 

async function checkProfiles() {
    console.log("🔍 Đang quét danh sách profile trong iXBrowser...");
    try {
        const response = await axios.post(`${BASE_URL}/api/v2/profile-list`, {
            page: 1,
            limit: 50 // Lấy 50 profile đầu tiên
        });

        // [FIX] Truy cập sâu thêm 1 lớp .data nữa để lấy mảng
        // Cấu trúc API: { code: 0, data: { total: 10, data: [ARRAY] }, ... }
        const apiData = response.data.data; 
        const list = apiData ? apiData.data : []; 
        
        if (!list || !Array.isArray(list) || list.length === 0) {
            console.log("⚠️ Không tìm thấy profile nào hoặc API trả về định dạng lạ.");
            console.log("📦 Raw Data:", JSON.stringify(response.data, null, 2));
            return;
        }

        console.log("\n✅ DANH SÁCH ID PROFILE HỢP LỆ:");
        console.log("----------------------------------------------------------------");
        console.log("|   ID   |          Tên Profile                   |");
        console.log("----------------------------------------------------------------");
        
        list.forEach(p => {
            // In ra ID và Tên để bạn chọn
            console.log(`|  ${String(p.profile_id).padEnd(5)} | ${p.name.padEnd(40)} |`);
        });
        console.log("----------------------------------------------------------------");
        console.log("👉 Hãy lấy số ở cột 'ID' điền vào file main.js");

    } catch (error) {
        console.error("❌ Lỗi:", error.message);
        if (error.response) {
             console.error("Chi tiết:", error.response.data);
        } else {
             console.error("👉 Hãy kiểm tra xem iXBrowser đã mở chưa?");
        }
    }
}

checkProfiles();