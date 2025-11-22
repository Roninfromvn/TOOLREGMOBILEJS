const puppeteer = require('puppeteer-core');
const IX = require('./ix_client');
const EmailUtils = require('./email_utils');
const Steps = require('./flows/reg_steps');

// Hàm ngủ (Sleep)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    // ===========================================================
    // 1. CẤU HÌNH & KHỞI TẠO
    // ===========================================================
    
    // [Input] Nhập Profile ID (Thay số này bằng ID thật của bạn lấy từ check_list.js)
    const PROFILE_ID = 1088; 

    console.log(`🚀 [Main] Bắt đầu chạy Profile ID: ${PROFILE_ID}`);

    // [Data] Tạo thông tin User (Giống logic generate_full_profile bên Python)
    let user;
    try {
        user = await EmailUtils.generateProfile();
        console.log("👤 User Data:", user);
    } catch (e) {
        console.log("⚠️ Không lấy được mail temp, dùng data ảo.");
        user = {
            firstname: "Tuan", lastname: "Nguyen",
            email: `test.reg${Date.now()}@gmail.com`,
            password: "Password123!",
            day: 15, month: 5, year: 2000, sex: 2
        };
    }

    // [Browser] Mở Profile iXBrowser -> Lấy WebSocket
    const wsEndpoint = await IX.openProfile(PROFILE_ID);
    if (!wsEndpoint) {
        console.error("❌ Không mở được Profile. Dừng.");
        return;
    }

    console.log("[Wait] Khởi động Mobile Browser (15s)...");
    await sleep(15000); // Chờ browser khởi động như Python

    let browser = null;
    let page = null;

    try {
        // Kết nối Puppeteer (Thay thế create_browser_session)
        console.log("🔌 Connecting to browser via CDP...");
        browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null
        });
        
        // Lấy page đầu tiên (giống session.page)
        const pages = await browser.pages();
        page = pages.length > 0 ? pages[0] : await browser.newPage();

        // ===========================================================
        // 2. FLOW CHÍNH (Mapping 1:1 từ Python main)
        // ===========================================================

        // if step_open_facebook_mobile(session):
        if (await Steps.step_open_facebook_mobile(page)) {
            
            await sleep(3000);

            // 1. Bấm nút Tạo tài khoản
            if (await Steps.step_click_create_account(page)) {
                console.log(">>> Chờ chuyển sang Form đăng ký...");
                await sleep(5000);

                // 2. Điền Tên
                await Steps.step_fill_name_mobile(page, user.firstname, user.lastname);
                await sleep(3000);

                // 3. Điền Ngày sinh
                // Python: d, m, y lấy từ user
                await Steps.step_fill_birthdate_mobile(page, user.day, user.month, user.year);
                await sleep(3000);

                // 4. Chọn Giới tính
                await Steps.step_select_gender_mobile(page, user.sex);
                await sleep(3000);

                // 5. Chuyển sang Email & Nhập Email
                if (await Steps.step_switch_to_email(page)) {
                    await Steps.step_fill_email_mobile(page, user.email);
                    await sleep(5000); // Đợi load trang pass

                    // 6. Nhập Mật khẩu
                    await Steps.step_fill_password_mobile(page, user.password);
                    await sleep(5000); // Đợi load trang save info

                    // 7. Bấm Save Login Info
                    await Steps.step_confirm_save_info(page);

                    // 8. Bấm Điều khoản (I Agree)
                    if (await Steps.step_confirm_terms(page)) {
                        console.log(">>> Đang chờ chuyển sang màn hình nhập OTP...");
                        // Chờ Facebook gửi mail
                        await sleep(10000); 

                        // 9. Lấy và Nhập OTP
                        // Python: otp_code = wait_for_fb_code(user['email'])
                        const otpCode = await EmailUtils.waitForCode(user.email);

                        if (otpCode) {
                            console.log(`📩 Đã lấy được code: ${otpCode}`);

                            // Gọi hàm nhập OTP
                            if (await Steps.step_fill_otp_mobile(page, otpCode)) {
                                
                                // 10. Kiểm tra kết quả cuối cùng
                                console.log("\n>>> Đang kiểm tra trạng thái sau khi nhập Code...");
                                await sleep(15000);
                                
                                const currentUrl = page.url();
                                if (currentUrl.includes("checkpoint")) {
                                    console.log("💀 Tài khoản bị Checkpoint (CP).");
                                } else {
                                    console.log("🎉 ĐĂNG KÝ THÀNH CÔNG! (Có thể đã vào Feed hoặc gợi ý kết bạn)");
                                    console.log("URL hiện tại: " + currentUrl);
                                }

                            } else {
                                console.log("❌ Lỗi khi nhập OTP.");
                            }
                        } else {
                            console.log("❌ Timeout: Không lấy được mã OTP từ email.");
                        }
                    }
                }
            }
        }

    } catch (e) {
        console.error("🔥 Lỗi Main Flow:", e);
    } finally {
        console.log("\n--- Treo 60s để kiểm tra kết quả ---");
        await sleep(60000);

        console.log("🔌 Đóng kết nối...");
        if (browser) browser.disconnect();
        
        // Uncomment dòng dưới nếu muốn tự động đóng profile iXBrowser luôn
        // await IX.closeProfile(PROFILE_ID);
    }
}

// Chạy hàm main
main();