const puppeteer = require('puppeteer-core');
const readline = require('readline');

// Import modules
const IX = require('./ix_client');
const MinProxy = require('./utils/minproxy');
const Logger = require('./utils/logger');
const EmailUtils = require('./email_utils');
const Steps = require('./flows/reg_steps');
const FBUtils = require('./utils/facebook'); // <--- [MỚI] Import check live

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MAX_RETRIES = 3; 
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// --- HÀM CHẠY 1 LẦN REG ---
async function runAttempt(browser, page, user) {
    console.log(">>> Bắt đầu Reg...");

    // ... (GIỮ NGUYÊN CÁC BƯỚC REG TỪ 1 ĐẾN 11) ...
    // Copy y nguyên logic cũ từ bước 1 đến bước 11
    
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
                    
                    // Lấy Cookie và UID
                    const cookies = await page.cookies();
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join(';');
                    const uidMatch = cookieStr.match(/c_user=(\d+)/);
                    
                    if (!uidMatch) {
                        return { status: 'FAIL', reason: 'No UID in Cookie', otp };
                    }

                    const uid = uidMatch[1];
                    const ua = await page.evaluate(() => navigator.userAgent);

                    // --- [MỚI] CHECK LIVE BẰNG GRAPH API ---
                    console.log(`🔎 Đang check live UID: ${uid} ...`);
                    const liveStatus = await FBUtils.checkLiveUID(uid);
                    
                    if (liveStatus === "LIVE") {
                        console.log("✅ UID LIVE -> Lưu thành công.");
                        return { status: 'SUCCESS', uid, cookie: cookieStr, otp, ua };
                    } else {
                        console.log("💀 UID DIE (Graph Check) -> Lưu thất bại.");
                        return { status: 'FAIL', reason: `Die sau Reg (${uid})`, otp, uid }; // Trả về UID để log
                    }
                    // ---------------------------------------

                }
                return { status: 'FAIL', reason: 'Input OTP Failed', otp };
            }
            return { status: 'FAIL', reason: 'Timeout OTP' };
        }
        return { status: 'FAIL', reason: 'Terms Failed' };
    }
    return { status: 'FAIL', reason: 'Switch Email Failed' };
}

// --- HÀM QUẢN LÝ VÒNG ĐỜI (GIỮ NGUYÊN) ---
async function runCycle(profileId, minProxyClient) {
    // ... (Giữ nguyên logic runCycle của file ok.js cũ) ...
    // Chỉ cần lưu ý phần xử lý kết quả:
    
    // (Đoạn này copy lại để bạn dễ hình dung, không cần sửa gì nếu đã đúng logic)
    console.log(`\n${"=".repeat(50)}\n BẮT ĐẦU CHU KỲ MỚI: PROFILE ${profileId}\n${"=".repeat(50)}`);

    try {
        const proxyData = await minProxyClient.getNewProxy();
        console.log("⏳ Đã lấy Proxy. Đợi 10s...");
        for(let i=10; i>0; i--) { process.stdout.write(`   Wait ${i}s...   \r`); await sleep(1000); }
        console.log("\n   -> Update Proxy...");
        const updateOk = await IX.updateProxy(profileId, proxyData);
        if (!updateOk) return false;
        await sleep(3000);
    } catch (e) { console.log("❌ Lỗi Proxy:", e.message); return false; }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`\n--- Thử lần ${attempt}/${MAX_RETRIES} ---`);
        const user = await EmailUtils.generateProfile();
        console.log("👤 User:", user.email, "| Pass:", user.password);
        const ws = await IX.openProfile(profileId);
        if (!ws) { await sleep(5000); continue; }

        let browser = null;
        try {
            browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
            const page = (await browser.pages())[0] || await browser.newPage();
            
            const result = await runAttempt(browser, page, user);
            
            const ua = result.ua || await page.evaluate(() => navigator.userAgent).catch(() => "N/A");

            if (result.status === 'SUCCESS') {
                console.log("\n🎉 REG THÀNH CÔNG!");
                Logger.saveSuccess(profileId, result.uid, user, result.cookie, result.otp, ua);
                browser.disconnect();
                console.log("🔓 Profile vẫn mở.");
                return true;
            } else {
                console.log(`❌ Thất bại: ${result.reason}`);
                // Nếu có UID chết thì ghi log kèm UID
                const failReason = result.uid ? `${result.reason} - UID: ${result.uid}` : result.reason;
                Logger.saveFail(profileId, user, failReason, ua);
            }
            browser.disconnect();
        } catch (e) {
            console.error("🔥 Crash:", e.message);
            if(browser) browser.disconnect();
        }
        await IX.closeProfile(profileId);
        await sleep(2000);
    }
    return false;
}

// --- MAIN (GIỮ NGUYÊN) ---
async function main() {
    const key = await ask("Nhập MinProxy Key: ");
    const id = await ask("Nhập Profile ID chạy xoay vòng: ");
    if (!key || !id) process.exit(0);

    const minProxy = new MinProxy(key.trim());
    const pid = parseInt(id.trim());

    while (true) {
        console.log("🔄 Đang đóng profile cũ...");
        await IX.closeProfile(pid);
        await sleep(2000);

        const success = await runCycle(pid, minProxy);
        
        if (success) {
            console.log("\n✅ Reg xong! Nghỉ 1 phút...");
            for(let i=60; i>0; i--) { process.stdout.write(`   Sleep ${i}s...   \r`); await sleep(1000); }
            console.log("\n");
        } else {
            console.log("\n❌ Reg xịt. Chạy lại...");
            await sleep(3000);
        }
    }
}

main();