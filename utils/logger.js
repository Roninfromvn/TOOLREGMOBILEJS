const fs = require('fs');
const path = require('path');

function getTimestamp() {
    return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
}

function appendFile(filename, content) {
    // [FIX] Sửa đường dẫn để lưu log vào ngay trong thư mục dự án
    // Từ 'utils' đi lên 1 cấp (..) là ra root của dự án
    const dir = path.join(__dirname, '../REG_OUTPUT'); 
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, filename);
    fs.appendFileSync(filePath, content + '\n', 'utf8');
}

// Format: ID | UID | Pass | Email | Time | Cookie | OTP | Name | UA
function saveSuccess(profileId, uid, user, cookie, otp, ua) {
    const time = getTimestamp();
    // Format chuẩn theo yêu cầu của bạn
    const line = `${profileId} | ${uid} | ${user.password} | ${user.email} | ${time} | ${cookie} | OTP: ${otp} | Full Name: ${user.firstname} ${user.lastname} | ${ua}`;
    
    console.log("💾 Đã lưu kết quả vào file success.");
    appendFile(`success_${new Date().toJSON().slice(0,10)}.txt`, line);
}

// Format: ID | Email | Pass | Time | Reason | UA
function saveFail(profileId, user, reason, ua="N/A") {
    const time = getTimestamp();
    const line = `${profileId} | ${user.email} | ${user.password} | ${time} | FAIL: ${reason} | ${ua}`;
    
    console.log(`💾 Đã lưu lỗi vào file fail: ${reason}`);
    appendFile(`fail_${new Date().toJSON().slice(0,10)}.txt`, line);
}

module.exports = { saveSuccess, saveFail };