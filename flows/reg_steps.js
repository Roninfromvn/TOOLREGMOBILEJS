const MOBILE_LIB = require('../mobile_lib.js');

// Helper: Ngủ
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: Inject Mobile Lib (để tìm tọa độ)
async function injectLib(page) {
    try { await page.evaluate(MOBILE_LIB); } catch {}
}

// --- HÀM QUAN TRỌNG: TAP BẰNG CDP (NGÓN TAY THẬT) ---
async function cdpTap(page, selector) {
    try {
        await injectLib(page);
        // 1. Tìm element và lấy tọa độ chính xác
        const box = await page.evaluate((sel) => {
            const findEl = () => {
                // Tìm theo Selector
                let el = document.querySelector(sel);
                if (el) return el;
                
                // Fallback: Tìm theo Text/Aria (Logic tìm kiếm nâng cao)
                const keywords = ["Get Started","Create new account", "Tạo tài khoản mới", "Next", "Tiếp", "Continue", "Save", "Lưu", "Agree", "Đồng ý", "Save"];
                const candidates = Array.from(document.querySelectorAll('div[role="button"], button, a, span'));
                
                return candidates.find(e => {
                    const t = (e.innerText || "").toLowerCase();
                    const a = (e.getAttribute("aria-label") || "").toLowerCase();
                    // Tìm khớp tương đối
                    return keywords.some(k => t.includes(k.toLowerCase()) || a.includes(k.toLowerCase()));
                });
            };

            const el = findEl();
            if (!el) return null;

            // Cuộn tới nó
            el.scrollIntoView({behavior: "auto", block: "center", inline: "center"});
            
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;

            // Trả về tọa độ tâm nút
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
        }, selector);

        if (!box) return false;

        console.log(`   👆 CDP Tap tại: (${Math.round(box.x)}, ${Math.round(box.y)})`);

        // 2. Gửi lệnh Touch thật qua giao thức CDP (IsTrusted: true)
        await page.touchscreen.tap(box.x, box.y);
        
        return true;

    } catch (e) {
        console.log("⚠️ Lỗi CDP Tap:", e.message);
        return false;
    }
}

// --- CÁC BƯỚC CHÍNH ---

// 1. Mở trang (Giữ nguyên fix lỗi Detached của bạn)
async function step_open_facebook_mobile(page) {
    console.log(">>> [Step] Truy cập m.facebook.com/reg ...");
    
    try {
        const client = await page.target().createCDPSession();
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch(e) {}

    try {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes("intent://") || req.url().includes("login_via/app")) req.abort();
            else req.continue();
        });
    } catch (e) {}

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`   ... Load trang lần ${attempt}`);
            await page.goto("https://m.facebook.com/reg", { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log(`   ⚠️ Goto Error: ${e.message}`);
        }

        // Check kỹ: Đợi 1 chút và xem có body không
        try {
            await sleep(3000);
            // Fix: Không chỉ check URL, check xem page có sống không
            const isAlive = await page.evaluate(() => !!document.body).catch(() => false);
            const currentUrl = page.url();

            if (isAlive && currentUrl.includes("facebook.com")) {
                console.log(`✅ Đã vào Facebook: ${currentUrl}`);
                await injectLib(page); 
                return true; 
            } else {
                console.log(`   ⚠️ URL: ${currentUrl} - Page Alive: ${isAlive}`);
            }
        } catch (err) {}
        await sleep(2000);
    }
    return false;
}

// 2. Click Create Account (Dùng CDP Tap)
async function step_click_create_account(page) {
    console.log(">>> [Step] Tìm nút 'Create new account'...");
    await sleep(2000);

    // Hàm kiểm tra an toàn (Safe Check)
    const checkIsOnForm = async () => {
        try {
            return await page.evaluate(() => {
                if (document.querySelector('input[name="firstname"]')) return true;
                if (document.querySelector('input[name="lastname"]')) return true;
                
                const inputs = Array.from(document.querySelectorAll('input'));
                const hasNameInput = inputs.some(i => {
                    const l = (i.getAttribute('aria-label') || "").toLowerCase();
                    return l.includes('first name') || l.includes('surname') || l.includes('họ') || l.includes('tên');
                });
                if (hasNameInput) return true;

                const bodyText = document.body.innerText;
                if (bodyText.includes("What's your name") || bodyText.includes("Bạn tên gì")) return true;

                return false;
            });
        } catch (e) {
            // [FIX QUAN TRỌNG] Nếu lỗi Detached Frame -> Coi như chưa thấy form, return false để retry
            if (e.message.includes("detached") || e.message.includes("target closed")) {
                console.log("   ⚠️ Frame bị ngắt (Loading...), thử lại...");
                return false; 
            }
            // Lỗi khác thì in ra
            console.log("   ⚠️ Lỗi check form:", e.message);
            return false;
        }
    };

    // Check ngay từ đầu
    if (await checkIsOnForm()) {
        console.log("🚀 Đã thấy Form điền tên (Bỏ qua click).");
        return true;
    }

    // Xử lý popup
    try {
        await page.evaluate(() => {
            [...document.querySelectorAll('div, span')].forEach(el => {
                if(el.innerText.match(/Lúc khác|Not now/i)) el.click();
            });
        });
    } catch (e) {}

    // Thử Tap vào nút Create
    // Nếu gặp lỗi Detached ở đây, cdpTap đã có try-catch bên trong rồi, nó sẽ trả về false
    let success = await cdpTap(page, 'div[role="button"][aria-label="Create new account"]');
    if (!success) success = await cdpTap(page, 'div[role="button"][aria-label="Tạo tài khoản mới"]');
    
    if (success) {
        console.log("⏳ Đang đợi chuyển trang (Max 10s)...");
        for(let i=0; i<10; i++) { 
            await sleep(1000);
            if (await checkIsOnForm()) {
                console.log("🚀 Chuyển trang thành công!");
                return true;
            }
        }
        console.log("⚠️ Đã Tap nhưng chưa thấy Form.");
    } else {
        // Fallback cuối cùng
        if (await checkIsOnForm()) return true;
        console.log("❌ Không tìm thấy nút Tạo và cũng không thấy Form.");
    }

    return false;
}

// Helper Click Next
async function clickNext(page) {
    // Tìm nút Next/Tiếp và tap
    await cdpTap(page, "BODY"); // Logic cdpTap tự tìm keyword Next/Tiếp
}

// 3. Điền Tên (Dùng Keyboard Type thật)
async function step_fill_name_mobile(page, firstname, lastname) {
    console.log(`>>> [Step] Điền Tên: ${firstname} ${lastname}`);
    try {
        await page.waitForSelector('input', {timeout: 15000});
        await injectLib(page);

        // Logic mới: Gán ID cho input rồi mới gõ
        await page.evaluate(async (fname, lname) => {
            // Tìm tất cả input text (trừ ô search)
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'))
                                .filter(i => i.id !== 'search_input'); 
            
            if (inputs.length >= 2) {
                // Trường hợp 2 ô: Họ và Tên
                // Gán ID tạm để Mobile.type tìm được
                inputs[0].id = 'input_surname_temp';
                inputs[1].id = 'input_firstname_temp';
                
                await window.Mobile.type('#input_surname_temp', lname);
                await window.Mobile.sleep(500);
                await window.Mobile.type('#input_firstname_temp', fname);
                
            } else if (inputs.length === 1) {
                // Trường hợp 1 ô: Fullname
                inputs[0].id = 'input_fullname_temp';
                await window.Mobile.type('#input_fullname_temp', fname + " " + lname);
            }
        }, firstname, lastname);

        await sleep(1000);

        // Bấm Next và Đợi chuyển trang
        console.log("   -> Đang tìm nút Next để bấm...");
        
        for (let i = 0; i < 3; i++) {
            // Tìm và bấm nút Next
            let tapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]'); 
            if (!tapped) tapped = await cdpTap(page, 'button[value="Next"]');
            if (!tapped) tapped = await clickNext(page);

            if (tapped) {
                console.log(`   -> Đã bấm Next (Lần ${i+1}). Đang đợi trang Ngày sinh...`);
                
                // Chờ tối đa 10s
                for (let k = 0; k < 10; k++) {
                    await sleep(1000);
                    const isDatePage = await page.evaluate(() => {
                        return !!document.querySelector('input[type="date"]') || 
                               !!document.querySelector('input[aria-label*="Birthday"]') ||
                               document.querySelectorAll('select').length >= 2;
                    });

                    if (isDatePage) {
                        console.log("🚀 Chuyển trang thành công! (Đã thấy Ngày sinh)");
                        return true;
                    }
                }
                console.log("⚠️ Chưa chuyển trang, bấm lại...");
            }
        }
        
        console.log("❌ Không qua được bước Điền tên.");

    } catch (e) { console.log("❌ Lỗi điền tên:", e.message); }
}

// 4. Ngày sinh
async function step_fill_birthdate_mobile(page, day, month, year) {
    console.log(`>>> [Step] Nhập Ngày sinh: ${day}/${month}/${year}`);
    
    // Chuẩn bị dữ liệu
    const dobIso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; // 2000-11-01
    const dobString = `${String(day).padStart(2,'0')}${String(month).padStart(2,'0')}${year}`; // 01112000 (Dùng để gõ phím)

    try {
        await injectLib(page);
        
        let filledSuccess = false;

        // --- CHIẾN THUẬT 1: Dùng Prototype Setter (Mạnh nhất) ---
        await page.evaluate(async (val) => {
            const el = document.querySelector('input[type="date"]');
            if(el) {
                el.focus();
                // Hack: Gọi setter gốc của HTMLInputElement để qua mặt React
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(el, val);
                
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                el.blur();
            }
        }, dobIso);

        await sleep(1000);

        // Kiểm tra lần 1
        let currentVal = await page.$eval('input[type="date"]', e => e.value).catch(() => "");
        if (currentVal === dobIso) {
            console.log("   ✅ (Cách 1) Ngày sinh đã được điền đúng.");
            filledSuccess = true;
        }

        // --- CHIẾN THUẬT 2: Nếu cách 1 xịt -> Dùng bàn phím gõ (Puppeteer Type) ---
        if (!filledSuccess) {
            console.log("   ⚠️ Cách 1 chưa ăn, thử dùng bàn phím gõ...");
            
            // Tap vào ô để focus
            await cdpTap(page, 'input[type="date"]');
            await sleep(500);
            
            // Gõ ngày tháng năm (Định dạng date input thường nhận phím số liên tục)
            // Gõ: 2000-11-01 hoặc 01-11-2000 tùy trình duyệt, nhưng thường gõ YYYY-MM-DD sẽ ăn
            await page.keyboard.type(dobString); 
            await sleep(500);
            
            // Kiểm tra lần 2
            currentVal = await page.$eval('input[type="date"]', e => e.value).catch(() => "");
            if (currentVal === dobIso) {
                console.log("   ✅ (Cách 2) Đã gõ xong ngày sinh.");
                filledSuccess = true;
            }
        }

        // --- CHIẾN THUẬT 3: JS setAttribute (Đường cùng) ---
        if (!filledSuccess) {
             console.log("   ⚠️ Cách 2 vẫn xịt, thử setAttribute...");
             await page.evaluate((val) => {
                const el = document.querySelector('input[type="date"]');
                if(el) el.setAttribute('value', val);
             }, dobIso);
             
             // Kiểm tra lần cuối nhưng không chặn nữa, cứ thử Next xem sao
             currentVal = await page.$eval('input[type="date"]', e => e.value).catch(() => "");
             if (currentVal === dobIso) filledSuccess = true;
        }

        // --- BẤM NEXT (QUYẾT TỬ) ---
        if (!filledSuccess) {
            console.log(`   ❌ Vẫn chưa điền được (Giá trị: ${currentVal}). Nhưng cứ thử bấm Next...`);
        }

        console.log("   -> Đang tìm nút Next...");
        
        for (let i = 0; i < 5; i++) {
            let tapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]');
            if (!tapped) tapped = await cdpTap(page, 'button[value="Next"]');
            if (!tapped) tapped = await clickNext(page);

            if (tapped) {
                console.log(`   -> Đã bấm Next (Lần ${i+1})...`);
                // Check xem đã qua trang Giới tính chưa
                for (let k = 0; k < 8; k++) {
                    await sleep(1000);
                    const isGenderPage = await page.evaluate(() => {
                        const text = document.body.innerText.toLowerCase();
                        return !!document.querySelector('input[type="radio"]') || text.includes("gender") || text.includes("giới tính");
                    });
                    
                    if (isGenderPage) {
                        console.log("🚀 Chuyển trang thành công! (Sang Giới tính)");
                        return true;
                    }
                }
            }
        }
        
        console.log("❌ Kẹt ở bước Ngày sinh.");

    } catch (e) { console.log("❌ Lỗi ngày sinh:", e.message); }
}

// 5. Giới tính
// 5. Giới tính (Đã Fix: Bấm Next xong phải ĐỢI sang trang SĐT)
async function step_select_gender_mobile(page, sexCode) {
    console.log(`>>> [Step] Chọn Giới tính...`);
    
    // Check an toàn: Có đúng là đang ở trang giới tính không?
    const isGenderPage = await page.evaluate(() => !!document.querySelector('input[type="radio"]') || document.body.innerText.toLowerCase().includes("gender"));
    if (!isGenderPage) {
        console.log("⚠️ Lỗi: Browser chưa ở trang Giới tính (Vẫn ở trang cũ). Bỏ qua bước này.");
        return;
    }

    // 2: Nam/Male, 1: Nu/Female
    const isMale = (String(sexCode) === '2');
    const labels = isMale ? ["Male", "Nam"] : ["Female", "Nữ"];

    try {
        await injectLib(page);
        
        // 1. Chọn giới tính
        await page.evaluate(async (lbls) => {
            const radios = Array.from(document.querySelectorAll('div[role="radio"]'));
            const target = radios.find(r => {
                const aria = r.getAttribute("aria-label") || "";
                const txt = r.innerText || "";
                return lbls.some(l => aria.includes(l) || txt.includes(l));
            });

            if (target) {
                target.id = "sex_option";
                await window.Mobile.tap("#sex_option");
            } else if (radios.length > 0) {
                radios[0].id = "sex_option_random";
                await window.Mobile.tap("#sex_option_random");
            }
        }, labels);

        await sleep(1000);

        // 2. Bấm Next và Đợi chuyển trang (QUAN TRỌNG)
        console.log("   -> Đang tìm nút Next...");
        
        for (let i = 0; i < 5; i++) {
            // Bấm Next
            let tapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]');
            if (!tapped) tapped = await cdpTap(page, 'button[value="Next"]');
            if (!tapped) tapped = await clickNext(page);

            if (tapped) {
                console.log(`   -> Đã bấm Next (Lần ${i+1}). Đang đợi trang nhập SĐT...`);
                
                // Chờ 10s xem có sang trang "Mobile Number" không
                for (let k = 0; k < 10; k++) {
                    await sleep(1000);
                    
                    // Dấu hiệu trang tiếp theo (Mobile number)
                    const isContactPage = await page.evaluate(() => {
                        const body = document.body.innerText.toLowerCase();
                        return !!document.querySelector('input[type="tel"]') || 
                               !!document.querySelector('input[name="reg_email__"]') ||
                               body.includes("mobile number") || 
                               body.includes("số di động") ||
                               body.includes("email address");
                    });

                    if (isContactPage) {
                        console.log("🚀 Chuyển trang thành công! (Đã sang màn hình Contact)");
                        return true;
                    }
                }
                console.log("⚠️ Vẫn kẹt ở Giới tính, bấm Next lại...");
            }
        }
        console.log("❌ Không qua được bước Giới tính.");

    } catch (e) { console.log("❌ Lỗi giới tính:", e.message); }
}

// 6. Email
async function step_switch_to_email(page) {
    console.log(">>> [Step] Chuyển sang Email...");
    await injectLib(page);
    
    // 1. Hàm check xem đã ở form nhập Email chưa?
    const isEmailForm = async () => {
        return await page.evaluate(() => {
            // Check input type email hoặc name reg_email__
            const input = document.querySelector('input[type="email"]') || document.querySelector('input[name="reg_email__"]');
            // Check text tiêu đề
            const text = document.body.innerText.toLowerCase();
            return !!input || text.includes("what's your email") || text.includes("địa chỉ email");
        });
    };

    // Nếu đã ở form Email rồi thì skip
    if (await isEmailForm()) {
        console.log("🚀 Đã ở Form Email.");
        return true;
    }

    // 2. Tìm và Tap nút "Sign up with email"
    console.log("   -> Tìm nút 'Sign up with email'...");
    
    try {
        const foundBtn = await page.evaluate(async () => {
            // Lấy tất cả các nút
            const candidates = Array.from(document.querySelectorAll('div[role="button"], button, span'));
            // Tìm nút có chữ "email"
            const target = candidates.find(el => el.innerText.toLowerCase().includes("email"));
            
            if (target) {
                // Cuộn tới
                target.scrollIntoView({behavior: "auto", block: "center"});
                const rect = target.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
            }
            return null;
        });

        if (foundBtn) {
            console.log(`   👆 Tap nút Email tại: (${Math.round(foundBtn.x)}, ${Math.round(foundBtn.y)})`);
            await page.touchscreen.tap(foundBtn.x, foundBtn.y);
            
            // Đợi chuyển trang (Max 10s)
            for(let k=0; k<10; k++) {
                await sleep(1000);
                if (await isEmailForm()) {
                    console.log("🚀 Chuyển Form thành công!");
                    return true;
                }
            }
            console.log("⚠️ Tap rồi nhưng chưa thấy Form Email.");
        } else {
            console.log("❌ Không tìm thấy nút chuyển Email.");
        }
    } catch (e) {
        console.log("⚠️ Lỗi thao tác chuyển email:", e.message);
    }
    
    // Fallback: Check lại lần cuối xem có tự chuyển không
    return await isEmailForm();
}

async function step_fill_email_mobile(page, email) {
    console.log(`>>> [Step] Nhập Email: ${email}`);
    try {
        await injectLib(page);
        
        // Chờ input xuất hiện
        await page.waitForSelector('input[name="reg_email__"]', {timeout: 10000}).catch(() => {});

        // 1. Focus và Nhập Email
        const inputFound = await page.evaluate(async () => {
            const el = document.querySelector('input[type="email"]') || document.querySelector('input[name="reg_email__"]');
            if (el) {
                el.focus();
                el.value = ""; 
                return true;
            }
            return false;
        });

        if (inputFound) {
            await sleep(500);
            await page.keyboard.type(email, {delay: 50});
            await sleep(1000);
            
            // 2. Bấm Next và Đợi chuyển trang Password
            console.log("   -> Đang tìm nút Next...");
            
            for (let i = 0; i < 5; i++) {
                // Thử bấm các loại nút Next
                let tapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]');
                if (!tapped) tapped = await cdpTap(page, 'button[value="Next"]');
                if (!tapped) tapped = await clickNext(page);

                if (tapped) {
                    console.log(`   -> Đã bấm Next (Lần ${i+1}). Đợi trang Mật khẩu...`);
                    
                    // Chờ 10s xem có sang trang Password không
                    for (let k = 0; k < 10; k++) {
                        await sleep(1000);
                        
                        // Dấu hiệu trang Password
                        const isPassPage = await page.evaluate(() => {
                            const body = document.body.innerText.toLowerCase();
                            return !!document.querySelector('input[type="password"]') || 
                                   body.includes("password") || 
                                   body.includes("mật khẩu");
                        });

                        if (isPassPage) {
                            console.log("🚀 Chuyển trang thành công! (Đã sang Mật khẩu)");
                            return true;
                        }
                    }
                    console.log("⚠️ Vẫn kẹt ở Email, bấm Next lại...");
                }
            }
            console.log("❌ Không qua được bước Email.");
        } else {
            console.log("❌ Không tìm thấy ô nhập Email.");
        }
        
    } catch (e) { console.log("❌ Lỗi nhập email:", e.message); }
}

// 7. Pass
async function step_fill_password_mobile(page, pass) {
    console.log(`>>> [Step] Nhập Pass: ${pass}`);
    try {
        const isPassPage = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
        if (!isPassPage) {
             console.log("⚠️ Lỗi: Chưa ở trang Mật khẩu. Chờ 5s...");
             await sleep(5000);
        }

        await page.waitForSelector('input[type="password"]', {timeout: 10000});
        await injectLib(page);
        
        // 1. Nhập Pass
        await page.evaluate(async (p) => {
            const el = document.querySelector('input[type="password"]') || document.querySelector('input[aria-label*="Pass"]');
            if(el) {
                el.focus();
                el.value = "";
            }
        }, pass);
        
        await page.keyboard.type(pass, {delay: 100});
        await sleep(1000);
        
        // 2. Bấm Next và Đợi
        console.log("   -> Đang tìm nút Next...");
        
        for (let i = 0; i < 5; i++) {
            let tapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]');
            if (!tapped) tapped = await cdpTap(page, 'button[value="Next"]');
            if (!tapped) tapped = await clickNext(page);

            if (tapped) {
                console.log(`   -> Đã bấm Next (Lần ${i+1}). Đang đợi trang kế tiếp...`);
                
                // Chờ 15s check chuyển trang
                for (let k = 0; k < 15; k++) {
                    await sleep(1000);
                    
                    const checkResult = await page.evaluate(() => {
                        const body = document.body.innerText.toLowerCase();
                        
                        // 1. Dấu hiệu trang Save Info (Nút Save/Not Now) - Check kỹ hơn
                        const hasSaveBtn = !!document.querySelector('div[aria-label="Save"]') || !!document.querySelector('div[aria-label="Lưu"]');
                        const hasNotNowBtn = !!document.querySelector('div[aria-label="Not now"]') || !!document.querySelector('div[aria-label="Lúc khác"]');
                        
                        if (hasSaveBtn || hasNotNowBtn || body.includes("save your login") || body.includes("lưu thông tin")) return "SAVE_INFO";
                        
                        // 2. Dấu hiệu I Agree (Bỏ qua Save Info)
                        if (body.includes("agree") || body.includes("đồng ý") || body.includes("policy")) return "TERMS";
                        
                        // 3. [QUAN TRỌNG] Dấu hiệu Input Password ĐÃ BIẾN MẤT -> Chắc chắn đã qua trang
                        const passInput = document.querySelector('input[type="password"]');
                        if (!passInput) return "PASS_GONE"; 

                        return null;
                    });

                    if (checkResult) {
                        console.log(`🚀 Chuyển trang thành công! (Dấu hiệu: ${checkResult})`);
                        return true;
                    }
                }
                console.log("⚠️ Vẫn thấy ô Password (hoặc chưa load xong), thử bấm Next lại...");
            }
        }
        console.log("❌ Không qua được bước Password.");

    } catch (e) { console.log("❌ Lỗi nhập password:", e.message); }
}

// 8. Save & Terms
async function step_confirm_save_info(page) {
    console.log(">>> [Step] Save Info...");
    
    // Check nếu đã qua
    const isTerms = await page.evaluate(() => {
        const t = document.body.innerText.toLowerCase();
        return t.includes("agree") || t.includes("đồng ý") || t.includes("policy");
    });
    if (isTerms) return true;

    const maxWait = 30;
    const start = Date.now();

    while (Date.now() - start < maxWait * 1000) {
        await injectLib(page);
        
        // Tìm tọa độ nút Save/Not Now bằng cách quét toàn bộ DOM
        const coords = await page.evaluate(() => {
            // Lấy tất cả element có thể click
            const allEls = Array.from(document.querySelectorAll('div, span, button, a'));
            
            // Tìm element chứa text mục tiêu
            const target = allEls.find(el => {
                // Chỉ lấy element đang hiển thị và có kích thước
                const r = el.getBoundingClientRect();
                if (r.width < 10 || r.height < 10) return false;

                const t = el.innerText.trim().toLowerCase();
                // Check từ khóa
                return t === "save" || t === "lưu" || t === "not now" || t === "lúc khác" || 
                       t === "save your login info"; // Đôi khi nó là tiêu đề nhưng click vào cũng focus
            });

            if (target) {
                // Tìm nút cha có role="button" nếu target chỉ là span text
                let clickable = target;
                if (target.tagName !== "BUTTON" && !target.getAttribute("role")) {
                    const parentBtn = target.closest('[role="button"], button');
                    if (parentBtn) clickable = parentBtn;
                }

                const r = clickable.getBoundingClientRect();
                return {
                    x: r.left + r.width / 2,
                    y: r.top + r.height / 2
                };
            }
            return null;
        });

        if (coords) {
            console.log(`   -> Tìm thấy nút Save/Not Now tại (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
            await page.touchscreen.tap(coords.x, coords.y);

            // Đợi chuyển trang
            for (let k = 0; k < 10; k++) {
                await sleep(1000);
                const isTermsNow = await page.evaluate(() => {
                    const t = document.body.innerText.toLowerCase();
                    return t.includes("agree") || t.includes("đồng ý") || t.includes("policy");
                });
                if (isTermsNow) {
                    console.log("🚀 Đã sang trang Điều khoản (I Agree).");
                    return true;
                }
            }
        } else {
            // Nếu không tìm thấy nút, thử click vào giữa màn hình phía dưới (Vị trí thường thấy của nút Not Now)
            console.log("⚠️ Không tìm thấy text nút Save. Thử click mù vào vị trí Not Now...");
            // Tọa độ ước lượng cho nút Not Now (thường nằm ở 1/2 chiều rộng, 80% chiều cao)
            await page.evaluate(() => {
                const x = window.innerWidth / 2;
                const y = window.innerHeight * 0.85; 
                return {x, y};
            }).then(pos => page.touchscreen.tap(pos.x, pos.y));
            await sleep(2000);
        }
        
        await sleep(1000);
    }
    console.log("❌ Timeout bước Save Info.");
    return false;
}

// 9. OTP
async function step_fill_otp_mobile(page, code) {
    console.log(`>>> [Step] Nhập OTP: ${code}`);
    try {
        await injectLib(page);

        // 1. Danh sách các selector tiềm năng cho ô OTP
        const selectors = [
            'input[name="c"]',                       // Cổ điển
            'input[name="code"]',                    // Phổ biến
            'input[type="number"]',                  // Input số
            'input[type="tel"]',                     // Bàn phím số
            'input[autocomplete="one-time-code"]',   // Chuẩn HTML5
            'input[placeholder*="code"]',            // Dựa vào placeholder (Confirmation code)
            'input[aria-label*="code"]',             // Dựa vào label
            'input[aria-label*="mã"]'
        ];

        let inputFound = false;

        // Thử Tap vào selector nào tìm thấy đầu tiên
        for (const sel of selectors) {
            // Dùng cdpTap để tìm và click (focus) luôn
            const tapped = await cdpTap(page, sel);
            if (tapped) {
                inputFound = true;
                break;
            }
        }

        // Fallback: Nếu không selector nào dính, tìm input bất kỳ đang hiển thị
        if (!inputFound) {
            console.log("⚠️ Không tìm thấy selector OTP chuẩn. Thử tìm input bất kỳ...");
            inputFound = await cdpTap(page, 'input');
        }

        if (inputFound) {
            console.log("   -> Đã focus ô input. Đang gõ mã...");
            await sleep(500);
            
            // 2. Gõ code bằng bàn phím (Delay chậm cho giống người)
            await page.keyboard.type(code, {delay: 200}); 
            await sleep(1000);

            // 3. Bấm Next/Confirm
            console.log("   -> Đang tìm nút Next/Confirm...");
            
            let nextTapped = await cdpTap(page, 'button[value="Next"]');
            if (!nextTapped) nextTapped = await cdpTap(page, 'div[role="button"][aria-label="Next"]');
            if (!nextTapped) nextTapped = await cdpTap(page, 'Next');     // Tìm theo text
            if (!nextTapped) nextTapped = await cdpTap(page, 'Confirm');  // Xác nhận
            if (!nextTapped) nextTapped = await cdpTap(page, 'Tiếp');
            
            if (nextTapped) {
                console.log("🚀 Đã bấm Next/Confirm. Chờ kết quả...");
                return true;
            } else {
                console.log("❌ Nhập được nhưng không thấy nút Next.");
            }
        } else {
            console.log("❌ Hoàn toàn không tìm thấy ô nhập OTP nào.");
        }

    } catch (e) { 
        console.log("❌ Lỗi nhập OTP:", e.message); 
    }
    return false;
}

async function step_confirm_terms(page) {
    console.log(">>> [Step] Xác nhận điều khoản (I Agree)...");
    
    const maxWait = 60;
    const start = Date.now();

    while (Date.now() - start < maxWait * 1000) {
        await injectLib(page);
        
        // 1. Cuộn xuống đáy (Bắt buộc)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(2000); // Đợi cuộn xong

        try {
            // 2. Tìm tọa độ nút I Agree (Logic chặt chẽ hơn)
            const coords = await page.evaluate(() => {
                // Chỉ tìm các thẻ có khả năng là nút
                const candidates = Array.from(document.querySelectorAll('div[role="button"], button, span[role="button"]'));
                
                // Tìm nút khớp CHÍNH XÁC văn bản (Không dùng includes bừa bãi)
                const target = candidates.find(b => {
                    // Chỉ lấy element đang hiển thị
                    if (b.offsetParent === null) return false;

                    const t = b.innerText.trim().toLowerCase(); // Text hiển thị
                    const l = (b.getAttribute("aria-label") || "").toLowerCase(); // Label ẩn

                    // So sánh chính xác tuyệt đối
                    if (t === "i agree" || t === "tôi đồng ý") return true;
                    if (l === "i agree" || l === "tôi đồng ý") return true;
                    
                    return false;
                });

                if (target) {
                    // Cuộn nút vào giữa màn hình
                    target.scrollIntoView({behavior: "auto", block: "center"});
                    const r = target.getBoundingClientRect();
                    return {
                        x: r.left + r.width / 2,
                        y: r.top + r.height / 2
                    };
                }
                return null;
            });

            if (coords) {
                console.log(`   👆 Tap Nút 'I Agree' tại: (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
                await page.touchscreen.tap(coords.x, coords.y);
                
                // Click bồi thêm 1 phát JS cho chắc (phòng trường hợp Tap trượt)
                await page.evaluate(() => {
                    const btns = document.querySelectorAll('div[role="button"], button');
                    for (let b of btns) {
                        if(b.innerText.trim().toLowerCase() === "i agree") b.click();
                    }
                });

                console.log("   -> Đã bấm. Đợi chuyển trang OTP...");
                
                // 3. Check xem đã sang OTP chưa
                for (let k = 0; k < 20; k++) { 
                    await sleep(1000);
                    const isOtpPage = await page.evaluate(() => {
                        const body = document.body.innerText.toLowerCase();
                        return !!document.querySelector('input[name="c"]') || 
                               !!document.querySelector('input[name="code"]') ||
                               !!document.querySelector('input[type="number"]') ||
                               body.includes("confirmation code") || 
                               body.includes("nhập mã");
                    });
                    
                    if (isOtpPage) {
                        console.log("🚀 Đã sang màn hình nhập OTP!");
                        return true;
                    }
                }
                console.log("⚠️ Chưa sang OTP, thử bấm lại...");
            } else {
                // Fallback: Nếu tìm chính xác không ra, mới tìm lỏng lẻo
                console.log("⚠️ Không thấy nút I Agree chuẩn. Thử tìm theo từ khóa...");
                let tapped = await cdpTap(page, "I agree");
                if (!tapped) tapped = await cdpTap(page, "Tôi đồng ý");
            }

        } catch(e) { console.log("Lỗi step terms:", e.message); }
        
        await sleep(2000);
    }
    console.log("❌ Timeout I Agree.");
    return false;
}

module.exports = {
    step_open_facebook_mobile,
    step_click_create_account,
    step_fill_name_mobile,
    step_fill_birthdate_mobile,
    step_select_gender_mobile,
    step_switch_to_email,
    step_fill_email_mobile,
    step_fill_password_mobile,
    step_confirm_save_info,
    step_confirm_terms,
    step_fill_otp_mobile
};