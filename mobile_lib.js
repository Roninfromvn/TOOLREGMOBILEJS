module.exports = `
window.Mobile = {
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),

  // 1. TAP (Click)
  async tap(selector) {
    let el = selector;
    if (typeof selector === 'string') el = document.querySelector(selector);
    if (!el) throw new Error("Element not found for tap: " + selector);

    el.scrollIntoView({behavior: "auto", block: "center", inline: "center"});
    await this.sleep(300);

    const rect = el.getBoundingClientRect();
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);

    const touchObj = new Touch({
      identifier: Date.now(),
      target: el,
      clientX: x, clientY: y,
      radiusX: 2.5, radiusY: 2.5,
      force: 1
    });

    el.dispatchEvent(new TouchEvent('touchstart', {
      cancelable: true, bubbles: true, touches: [touchObj], targetTouches: [touchObj], changedTouches: [touchObj]
    }));
    await this.sleep(50);
    el.dispatchEvent(new TouchEvent('touchend', {
      cancelable: true, bubbles: true, touches: [], targetTouches: [], changedTouches: [touchObj]
    }));
    
    el.click(); 
  },

  // 2. TYPE (Gõ phím - ĐÃ FIX LỖI NHẬN ELEMENT)
  async type(selector, text) {
    let el = selector;
    // Nếu selector là chuỗi thì tìm, nếu là element thì dùng luôn
    if (typeof selector === 'string') el = document.querySelector(selector);
    
    if (!el) throw new Error("Input not found for type: " + selector);
    
    el.scrollIntoView({behavior: "auto", block: "center"});
    el.focus();
    el.value = ""; // Xóa nội dung cũ
    
    // Hack React/Facebook Input
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeInputValueSetter.call(el, text);
    
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await this.sleep(100);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur(); 
  }
};
`;