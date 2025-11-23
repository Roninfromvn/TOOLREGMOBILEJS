// email_utils.js
const axios = require('axios');
const { fakerVI: faker } = require('@faker-js/faker');
const BASE_MAIL_API = "https://mail-temp.site";

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function removeAccents(str) {
    return str.normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "") // Bỏ dấu huyền, sắc...
              .replace(/đ/g, "d").replace(/Đ/g, "D") // Chuyển đ -> d
              .replace(/\s+/g, "") // <--- [QUAN TRỌNG] Xóa hết dấu cách
              .trim(); 
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
    // 1. Random tên có dấu
    const firstName = faker.person.firstName(); // VD: "Minh Vũ"
    const lastName = faker.person.lastName();   // VD: "Dương"
    
    // 2. Clean tên để làm Email (Bỏ dấu + Bỏ cách + Chữ thường)
    // VD: "Minh Vũ" -> "minhvu"
    const cleanFirst = removeAccents(firstName).toLowerCase();
    const cleanLast = removeAccents(lastName).toLowerCase();
    
    // 3. Lấy domain
    const domains = await getTempDomains();
    const domain = domains[randomInt(0, domains.length - 1)];
    
    // 4. Tạo email: minhvu.duong_396_vn@...
    const email = `${cleanFirst}.${cleanLast}_${randomInt(100,999)}_vn@${domain}`;
    
    // 5. Tạo Password: MinhVuDuong@2000
    // Pass thì giữ nguyên dấu cũng được, hoặc bỏ dấu tùy bạn (ở đây tôi bỏ dấu cho an toàn)
    const passFirst = removeAccents(firstName);
    const passLast = removeAccents(lastName);
    
    const d = randomInt(1, 28);
    const m = randomInt(1, 12);
    const y = randomInt(1995, 2005);
    
    // Format pass: TenHo@NgayThang
    const password = `${passFirst}${passLast}@${d < 10 ? '0'+d : d}${m < 10 ? '0'+m : m}`;

    return {
        firstname: firstName, // Tên thật để điền Form (có dấu, có cách)
        lastname: lastName,   
        email: email,         // Email (không dấu, không cách)
        password: password,
        day: d, month: m, year: y,
        sex: randomInt(1, 2)
    };
}

async function waitForCode(email) {
    console.log(`⏳ Đang chờ OTP cho: ${email} (Tối đa 60s)...`);
    const endTime = Date.now() + 60000; 

    while (Date.now() < endTime) {
        try {
            const res = await axios.get(`${BASE_MAIL_API}/checkmail.php?mail=${email}`);
            if (res.data.success && res.data.emails) {
                for (let mail of res.data.emails) {
                    const subject = (mail.subject || "").toLowerCase();
                    const body = (mail.text || mail.html || "").toLowerCase(); // Check cả nội dung
                    
                    // Regex tìm code 5 số hoặc FB-12345
                    const match = subject.match(/fb-(\d{5})/) || 
                                  subject.match(/\b(\d{5})\b/) || 
                                  body.match(/\b(\d{5})\b/);
                    
                    if (match) return match[1];
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 3000)); 
    }
    return null;
}

module.exports = { generateProfile, waitForCode };