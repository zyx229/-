// Service Worker - 后台位置追踪
// 即使浏览器关闭、后台被清理，仍会被系统周期性唤醒

const SIGNAL_SERVER = 'wss://broker.emqx.io:8084/mqtt';
const ROOM_PREFIX = 'loc_room_';
let deviceId = '';
let ws = null;
let watchId = null;

// 安装事件
self.addEventListener('install', event => {
    console.log('[SW] Installed');
    self.skipWaiting();
});

// 激活事件
self.addEventListener('activate', event => {
    console.log('[SW] Activated');
    event.waitUntil(self.clients.claim());
    
    // 激活后立即开始定位
    startLocationTracking();
});

// 周期性后台同步（系统会定期唤醒SW）
self.addEventListener('periodicsync', event => {
    if (event.tag === 'location-sync') {
        console.log('[SW] Periodic sync triggered');
        event.waitUntil(getAndSendLocation());
    }
});

// 消息处理
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SET_DEVICE_ID') {
        deviceId = event.data.deviceId;
        startLocationTracking();
    }
});

// 推送事件（可用于远程唤醒）
self.addEventListener('push', event => {
    console.log('[SW] Push received, fetching location');
    event.waitUntil(getAndSendLocation());
});

// 启动位置追踪
function startLocationTracking() {
    console.log('[SW] Starting location tracking...');
    
    // 使用Geolocation API持续追踪
    if ('geolocation' in self.navigator) {
        // 高频率获取位置
        setInterval(() => {
            getAndSendLocation();
        }, 30000); // 每30秒获取一次
    }
}

// 获取位置并发送
function getAndSendLocation() {
    return new Promise((resolve) => {
        if (!('geolocation' in self.navigator)) {
            resolve(false);
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            position => {
                const locationData = {
                    type: 'location',
                    deviceId: deviceId,
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    speed: position.coords.speed || 0,
                    heading: position.coords.heading || 0,
                    timestamp: Date.now()
                };
                
                sendToSignalServer(locationData);
                resolve(true);
            },
            error => {
                console.log('[SW] Location error:', error.message);
                resolve(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// 通过WebSocket发送到信令服务器
function sendToSignalServer(data) {
    try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            ws = new WebSocket(SIGNAL_SERVER);
            
            ws.onopen = () => {
                const roomTopic = ROOM_PREFIX + (deviceId || 'default');
                ws.send(JSON.stringify({
                    type: 'publish',
                    topic: roomTopic,
                    payload: JSON.stringify(data)
                }));
            };
            
            ws.onerror = () => {
                ws = null;
            };
        } else {
            const roomTopic = ROOM_PREFIX + (deviceId || 'default');
            ws.send(JSON.stringify({
                type: 'publish',
                topic: roomTopic,
                payload: JSON.stringify(data)
            }));
        }
    } catch(e) {
        console.log('[SW] Send error:', e);
    }
}

// 保持Service Worker活跃
self.addEventListener('fetch', event => {
    // 拦截所有请求，保持SW生命周期
    event.respondWith(fetch(event.request));
});

// SW被唤醒时重新开始追踪
startLocationTracking();
