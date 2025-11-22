// email_utils.js
const axios = require('axios');

const BASE_MAIL_API = "https://mail-temp.site";

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getTempDomains() {
    try {
        const res = await axios.get(`${BASE_MAIL_API}/list_domain.php`);
        if (res.data.success && res.data.domains.length > 0) {
            return res.data.domains;
        }
    } catch (e) {}
    return ["mail-temp.site"];
}

async function generateProfile() {
    // Random tên đơn giản
    const firstNames = ["Tuan", "Hung", "Nam", "Linh", "Mai", "Hoa", "Duc", "Viet"];
    const lastNames = ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vo", "Dang"];
    
    const first = firstNames[randomInt(0, firstNames.length - 1)];
    const last = lastNames[randomInt(0, lastNames.length - 1)];
    
    // Lấy domain
    const domains = await getTempDomains();
    const domain = domains[randomInt(0, domains.length - 1)];
    
    // Tạo email
    const email = `${first.toLowerCase()}.${last.toLowerCase()}_${randomInt(100,999)}_vn@${domain}`;
    
    // Password format: TenHo@NgayThang
    const d = randomInt(1, 28);
    const m = randomInt(1, 12);
    const y = randomInt(1995, 2005);
    const pass = `${first}${last}@${d < 10 ? '0'+d : d}${m < 10 ? '0'+m : m}`;

    return {
        firstname: first,
        lastname: last,
        email: email,
        password: pass,
        day: d, month: m, year: y,
        sex: randomInt(1, 2) // 1: Nu, 2: Nam
    };
}

async function waitForCode(email) {
    console.log(`⏳ Đang chờ OTP cho: ${email} (Tối đa 60s)...`);
    const endTime = Date.now() + 60000; // Chờ 60s

    while (Date.now() < endTime) {
        try {
            const res = await axios.get(`${BASE_MAIL_API}/checkmail.php?mail=${email}`);
            if (res.data.success && res.data.emails) {
                for (let mail of res.data.emails) {
                    const subject = mail.subject || "";
                    // Regex tìm code FB
                    const match = subject.match(/FB-(\d{5,8})/) || subject.match(/\b(\d{5,8})\b/);
                    if (match) return match[1];
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 3000)); // Nghỉ 3s check lại
    }
    return null;
}

module.exports = { generateProfile, waitForCode };