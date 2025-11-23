const puppeteer = require('puppeteer-core');
const readline = require('readline');

// Import modules
const IX = require('./ix_client');
const MinProxy = require('./utils/minproxy');
const Logger = require('./utils/logger');
const EmailUtils = require('./email_utils');
const Steps = require('./flows/reg_steps');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Config
const MAX_RETRIES = 3; // Số lần thử lại trên 1 Proxy

// Hàm lấy User Input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// --- HÀM CHẠY 1 LẦN REG ---
async function runAttempt(browser, page, user) {
    console.log(">>> Bắt đầu Reg...");

    // 1. Mở FB
    if (!await Steps.step_open_facebook_mobile(page)) return { status: 'FAIL', reason: 'Cannot Open FB' };
    await sleep(2000);
    
    // 2. Click Create
    if (!await Steps.step_click_create_account(page)) return { status: 'FAIL', reason: 'Cannot Click Create' };
    await sleep(2000);
    
    // 3. Điền Info
    await Steps.step_fill_name_mobile(page, user.firstname, user.lastname);
    await Steps.step_fill_birthdate_mobile(page, user.day, user.month, user.year);
    await Steps.step_select_gender_mobile(page, user.sex);
    
    // 4. Email & Pass
    if (await Steps.step_switch_to_email(page)) {
        await Steps.step_fill_email_mobile(page, user.email);
        await Steps.step_fill_password_mobile(page, user.password);
        
        // 5. Save & Terms
        await Steps.step_confirm_save_info(page);
        
        if (await Steps.step_confirm_terms(page)) {
            console.log(">>> Đang chờ OTP (Logic gửi lại mã)...");
            
            // Logic chờ OTP thông minh
            let otp = null;
            
            // Lần 1
            await sleep(10000);
            otp = await EmailUtils.waitForCode(user.email);
            
            // Nếu không có, thử tìm nút Gửi lại
            if (!otp) {
                console.log("⚠️ Không thấy mã. Thử bấm 'Send code again'...");
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
                    
                    // Lấy Cookie, UID, UA
                    const cookies = await page.cookies();
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join(';');
                    const uidMatch = cookieStr.match(/c_user=(\d+)/);
                    const uid = uidMatch ? uidMatch[1] : "NoUID";
                    const ua = await page.evaluate(() => navigator.userAgent);

                    return { status: 'SUCCESS', uid, cookie: cookieStr, otp, ua };
                }
                return { status: 'FAIL', reason: 'Input OTP Failed', otp };
            }
            return { status: 'FAIL', reason: 'Timeout OTP' };
        }
        return { status: 'FAIL', reason: 'Terms Failed' };
    }
    return { status: 'FAIL', reason: 'Switch Email Failed' };
}

// --- HÀM QUẢN LÝ VÒNG ĐỜI (PROXY -> RETRY) ---
async function runCycle(profileId, minProxyClient) {
    console.log(`\n${"=".repeat(50)}\n BẮT ĐẦU CHU KỲ MỚI: PROFILE ${profileId}\n${"=".repeat(50)}`);

    // 1. Lấy Proxy & Update
    try {
        const proxyData = await minProxyClient.getNewProxy();
        
        // [FIX MỚI] Chờ 10s để IP mới kịp "ngấm" (Online)
        console.log("⏳ Đã lấy Proxy. Đợi 10s để IP ổn định trước khi gắn vào Profile...");
        for(let i=10; i>0; i--) {
            process.stdout.write(`   Wait ${i}s...   \r`);
            await sleep(1000);
        }
        console.log("\n   -> Bắt đầu Update Proxy...");

        const updateOk = await IX.updateProxy(profileId, proxyData);
        
        if (!updateOk) {
            console.log("⚠️ Update Proxy thất bại (iXBrowser từ chối). Bỏ qua chu kỳ này.");
            return false;
        }
        
        console.log("   -> Proxy đã nhận. Đợi thêm 3s khởi động...");
        await sleep(3000);

    } catch (e) {
        console.log("❌ Lỗi lấy/gắn Proxy:", e.message);
        return false;
    }

    // 2. Retry Loop (Thử 3 lần trên cùng 1 proxy)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`\n--- Thử lần ${attempt}/${MAX_RETRIES} ---`);
        
        const user = await EmailUtils.generateProfile();
        console.log("👤 User:", user.email, "| Pass:", user.password);

        const ws = await IX.openProfile(profileId);
        if (!ws) {
            console.log("❌ Không mở được Profile. Retrying...");
            await sleep (5000);
            continue;
        }

        let browser = null;
        try {
            browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
            const page = (await browser.pages())[0] || await browser.newPage();
            
            // CHẠY REG
            const result = await runAttempt(browser, page, user);
            
            // Lấy UA
            const ua = result.ua || await page.evaluate(() => navigator.userAgent).catch(() => "N/A");

            if (result.status === 'SUCCESS') {
                console.log("\n🎉 REG THÀNH CÔNG!");
                Logger.saveSuccess(profileId, result.uid, user, result.cookie, result.otp, ua);
                
                browser.disconnect();
                await IX.closeProfile(profileId);
                return true; // Thành công -> Thoát
            } else {
                console.log(`❌ Thất bại: ${result.reason}`);
                Logger.saveFail(profileId, user, result.reason, ua);
            }
            
            browser.disconnect();

        } catch (e) {
            console.error("🔥 Crash:", e.message);
            if(browser) browser.disconnect();
        }

        await IX.closeProfile(profileId);
        await sleep(2000);
    }

    console.log("❌ Thất bại sau 3 lần thử. Sẽ đổi Proxy.");
    return false;
}

// --- MAIN ---
async function main() {
    const key = await ask("Nhập MinProxy Key: ");
    const id = await ask("Nhập Profile ID chạy xoay vòng: ");
    
    if (!key || !id) {
        console.log("Thiếu thông tin. Thoát.");
        process.exit(0);
    }

    const minProxy = new MinProxy(key.trim());
    const pid = parseInt(id.trim());

    while (true) {
        const success = await runCycle(pid, minProxy);
        
        if (success) {
            console.log("\n✅ Reg xong! Nghỉ 1 phút (60s) rồi chạy tiếp...");
            for(let i=60; i>0; i--) {
                process.stdout.write(`   Sleep ${i}s...   \r`);
                await sleep(1000);
            }
            console.log("\n");
        } else {
            console.log("\n❌ Reg xịt cả 3 lần. Đổi Proxy chạy lại ngay...");
            await sleep(3000);
        }
    }
}

main();