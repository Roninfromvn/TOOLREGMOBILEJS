const puppeteer = require('puppeteer-core');
const readline = require('readline');

// Import modules (Giữ nguyên như cũ)
const IX = require('./ix_client');
const MinProxy = require('./utils/minproxy');
const Logger = require('./utils/logger');
const EmailUtils = require('./email_utils');
const Steps = require('./flows/reg_steps');
const FBUtils = require('./utils/facebook');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAX_RETRIES = 1; // Test thì để 1 lần retry thôi cho đỡ tốn thời gian
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// --- CẤU HÌNH USER AGENT MONG MUỐN ---
const TARGET_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// --- HÀM CHẠY 1 LẦN REG (GIỮ NGUYÊN LOGIC CŨ) ---
async function runAttempt(browser, page, user) {
    console.log(">>> Bắt đầu Reg...");

    // [DEBUG] In ra UA thực tế để kiểm tra xem đã nhận chưa
    const currentUA = await page.evaluate(() => navigator.userAgent);
    console.log(`\n📱 [CHECK UA] Trình duyệt đang chạy với UA:`);
    console.log(`   ${currentUA}`);
    
    if (currentUA === TARGET_UA) {
        console.log("   ✅ UA ĐÃ KHỚP! Tiếp tục Reg...");
    } else {
        console.log("   ⚠️ UA KHÔNG KHỚP. Có thể API update chưa ăn hoặc iXBrowser tự đổi.");
    }
    console.log("-".repeat(30));

    // Copy y nguyên logic cũ từ ok.js
    if (!await Steps.step_open_facebook_mobile(page)) return { status: 'FAIL', reason: 'Cannot Open FB' };
    await sleep(2000);
    if (!await Steps.step_click_create_account(page)) return { status: 'FAIL', reason: 'Cannot Click Create' };
    await sleep(2000);
    await Steps.step_fill_name_mobile(page, user.firstname, user.lastname);
    await Steps.step_fill_birthdate_mobile(page, user.day, user.month, user.year);
    await Steps.step_select_gender_mobile(page, user.sex);
    
    if (await Steps.step_switch_to_email(page)) {
        await Steps.step_fill_email_mobile(page, user.email);
        await Steps.step_fill_password_mobile(page, user.password);
        await Steps.step_confirm_save_info(page);
        
        if (await Steps.step_confirm_terms(page)) {
            console.log(">>> Đang chờ OTP...");
            
            let otp = null;
            await sleep(10000);
            otp = await EmailUtils.waitForCode(user.email);
            
            if (!otp) {
                console.log("⚠️ Thử bấm 'Send code again'...");
                await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a, div[role="button"]'));
                    const resend = links.find(el => el.innerText.match(/Send code again|Gửi lại/i));
                    if(resend) resend.click();
                });
                await sleep(10000);
                otp = await EmailUtils.waitForCode(user.email);
            }

            if (otp) {
                console.log(`📩 OTP: ${otp}`);
                if (await Steps.step_fill_otp_mobile(page, otp)) {
                    console.log(">>> Check kết quả cuối...");
                    await sleep(15000);
                    
                    const url = page.url();
                    if (url.includes("checkpoint")) return { status: 'FAIL', reason: 'Checkpoint Instant', otp };
                    
                    const cookies = await page.cookies();
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join(';');
                    const uidMatch = cookieStr.match(/c_user=(\d+)/);
                    
                    if (!uidMatch) {
                        return { status: 'FAIL', reason: 'No UID in Cookie', otp };
                    }

                    const uid = uidMatch[1];
                    const ua = await page.evaluate(() => navigator.userAgent);

                    console.log(`🔎 Đang check live UID: ${uid} ...`);
                    const liveStatus = await FBUtils.checkLiveUID(uid);
                    
                    if (liveStatus === "LIVE") {
                        console.log("✅ UID LIVE -> Lưu thành công.");
                        return { status: 'SUCCESS', uid, cookie: cookieStr, otp, ua };
                    } else {
                        console.log("💀 UID DIE (Graph Check) -> Lưu thất bại.");
                        return { status: 'FAIL', reason: `Die sau Reg (${uid})`, otp, uid };
                    }
                }
                return { status: 'FAIL', reason: 'Input OTP Failed', otp };
            }
            return { status: 'FAIL', reason: 'Timeout OTP' };
        }
        return { status: 'FAIL', reason: 'Terms Failed' };
    }
    return { status: 'FAIL', reason: 'Switch Email Failed' };
}

// --- HÀM QUẢN LÝ VÒNG ĐỜI (SỬA ĐỔI ĐỂ UPDATE PROFILE) ---
async function runCycle(profileId, minProxyClient) {
    console.log(`\n${"=".repeat(50)}\n BẮT ĐẦU TEST UA: PROFILE ${profileId}\n${"=".repeat(50)}`);

    // 1. Lấy Proxy và Update Proxy (Giữ nguyên để đảm bảo môi trường mạng giống thật)
    try {
        const proxyData = await minProxyClient.getNewProxy();
        console.log("⏳ Đã lấy Proxy. Đợi 5s..."); // Test thì đợi ít hơn chút
        for(let i=5; i>0; i--) { process.stdout.write(`   Wait ${i}s...   \r`); await sleep(1000); }
        console.log("\n   -> Update Proxy...");
        const updateProxyOk = await IX.updateProxy(profileId, proxyData);
        if (!updateProxyOk) return false;
        await sleep(2000);
    } catch (e) { console.log("❌ Lỗi Proxy:", e.message); return false; }

    // 2. [QUAN TRỌNG] UPDATE FINGERPRINT TRƯỚC KHI MỞ
    console.log("🛠️ Đang cấu hình User Agent iOS 17...");
    const configUpdate = {
        fingerprint_config: {
            ua_type: 2,           // Mobile
            platform: "IOS",      // iOS
            ua_info: TARGET_UA,   // UA Cụ thể
            hide_debug_panel: "1"
        }
    };

    // Gọi hàm updateProfile mà bạn đã thêm vào ix_client
    const updateConfigOk = await IX.updateProfile(profileId, configUpdate);
    if (!updateConfigOk) {
        console.log("❌ Lỗi Update cấu hình Profile. Dừng.");
        return false;
    }
    await sleep(2000);

    // 3. Chạy Reg
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`\n--- Test lần ${attempt}/${MAX_RETRIES} ---`);
        const user = await EmailUtils.generateProfile();
        console.log("👤 User:", user.email, "| Pass:", user.password);
        
        // [QUAN TRỌNG] Dùng hàm openProfileNormal để KHÔNG bị random lại UA
        const ws = await IX.openProfileNormal(profileId);
        
        if (!ws) { await sleep(5000); continue; }

        let browser = null;
        try {
            browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
            const page = (await browser.pages())[0] || await browser.newPage();
            
            // Chạy logic Reg
            const result = await runAttempt(browser, page, user);
            
            const ua = result.ua || await page.evaluate(() => navigator.userAgent).catch(() => "N/A");

            if (result.status === 'SUCCESS') {
                console.log("\n🎉 TEST REG THÀNH CÔNG VỚI UA MỚI!");
                Logger.saveSuccess(profileId, result.uid, user, result.cookie, result.otp, ua);
                browser.disconnect();
                console.log("🔓 Profile vẫn mở để bạn kiểm tra.");
                return true; 
            } else {
                console.log(`❌ Thất bại: ${result.reason}`);
                const failReason = result.uid ? `${result.reason} - UID: ${result.uid}` : result.reason;
                Logger.saveFail(profileId, user, failReason, ua);
            }
            browser.disconnect();
        } catch (e) {
            console.error("🔥 Crash:", e.message);
            if(browser) browser.disconnect();
        }
        
        // Đóng profile sau khi test xong (hoặc comment lại nếu muốn soi)
        console.log("🔄 Đang đóng profile...");
        await IX.closeProfile(profileId);
        await sleep(2000);
    }
    return false;
}

// --- MAIN ---
async function main() {
    const key = await ask("Nhập MinProxy Key: ");
    const id = await ask("Nhập Profile ID để test: ");
    if (!key || !id) process.exit(0);

    const minProxy = new MinProxy(key.trim());
    const pid = parseInt(id.trim());

    // Đóng profile cũ cho chắc
    await IX.closeProfile(pid);
    
    // Chạy vòng lặp test
    while (true) {
        const success = await runCycle(pid, minProxy);
        
        const ans = await ask("\n❓ Bạn có muốn chạy lại test lần nữa không? (y/n): ");
        if (ans.toLowerCase() !== 'y') break;
    }
}

main();