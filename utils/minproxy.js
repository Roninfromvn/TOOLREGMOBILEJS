const axios = require('axios');

class MinProxyClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = "https://dash.minproxy.vn/api/rotating/v1/proxy";
    }

    async getNewProxy() {
        try {
            const url = `${this.baseUrl}/get-new-proxy?api_key=${this.apiKey}`;
            const res = await axios.get(url);
            const data = res.data;

            // Trường hợp thành công
            if (data.code === 2) {
                console.log(`✅ MinProxy: Đã lấy IP mới: ${data.data.http_proxy}`);
                return data.data; // { http_proxy: "ip:port", username: "...", password: "..." }
            }
            
            // Trường hợp chưa đến giờ đổi (code 1) -> Chờ
            if (data.code === 1) {
                let waitTime = data.data?.next_request || 60;
                console.log(`⏳ MinProxy: Chưa được đổi IP. Cần chờ ${waitTime}s...`);
                
                // Đếm ngược chờ
                while(waitTime > 0) {
                    process.stdout.write(`   Wait ${waitTime}s...   \r`);
                    await new Promise(r => setTimeout(r, 1000));
                    waitTime--;
                }
                console.log("\n🔄 Đang thử lấy lại Proxy...");
                return await this.getNewProxy(); // Gọi đệ quy thử lại
            }

            throw new Error(`MinProxy Error Code ${data.code}: ${data.message}`);

        } catch (e) {
            console.error("❌ Lỗi kết nối MinProxy:", e.message);
            throw e;
        }
    }
}

module.exports = MinProxyClient;