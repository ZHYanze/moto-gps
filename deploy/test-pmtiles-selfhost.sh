#!/bin/sh
###############################################################################
# 测试:PMTiles 自托管是否正常(NAS fnOS + docker-compose + nginx sidecar)
#
# 架构:NAS 上 pmtiles nginx 容器 listen 127.0.0.1:8788,
#      backend 通过 http://localhost:8788 直连。
#
# 用法:在 NAS 部署根目录下执行(和 docker-compose.yml 同目录)
#       sh deploy/test-pmtiles-selfhost.sh
#
# 也可整段复制到终端逐条跑。
###############################################################################

echo "═══════════════════════════════════════════════"
echo "  PMTiles 自托管测试脚本(localhost:8788 方案)"
echo "═══════════════════════════════════════════════"

# 0. 容器是否在跑?
echo ""
echo "[0] 容器状态"
echo "---"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "pmtiles|backend"
echo "--- 期望两个都 Up(backend 可能不带 healthy,但不能是 Restarting/Exited) ---"

# 1. PMTiles 容器内能看到文件
echo ""
echo "[1] PMTiles 容器内文件列表"
echo "---"
docker exec moto-gps-pmtiles ls -la /usr/share/nginx/html/
echo "--- 期望看到 china.pmtiles(以及其他 .pmtiles 文件) ---"

# 2. nginx 健康检查(IPv4 强制)
echo ""
echo "[2] nginx /health 端点(IPv4)"
echo "---"
docker exec moto-gps-pmtiles wget -O /dev/null -S http://127.0.0.1/health 2>&1 | head -10
echo "--- 期望看到 HTTP/1.1 200 OK ---"

# 3. backend → pmtiles 走 HTTP Range
echo ""
echo "[3] backend 取 PMTiles 文件头(前 7 字节是 'PMTiles')"
echo "---"
docker exec moto-gps-backend wget -O /tmp/range.bin \
  --header="Range: bytes=0-127" \
  http://localhost:8788/china.pmtiles 2>&1 | tail -5
echo "下载内容前 16 字节(hex):"
docker exec moto-gps-backend sh -c 'xxd /tmp/range.bin 2>/dev/null | head -1 || od -An -tx1 -N 16 /tmp/range.bin'
echo "--- 期望前 7 字节是 504d54696c6573 = 'PMTiles' ---"

# 4. 文件大小一致?
echo ""
echo "[4] 文件大小一致性检查"
echo "---"
NAS_SIZE=$(stat -c '%s' /vol1/1000/docker/moto-gps/map/china.pmtiles 2>/dev/null)
CONTAINER_SIZE=$(docker exec moto-gps-pmtiles stat -c '%s' /usr/share/nginx/html/china.pmtiles)
echo "NAS 上文件大小:     $NAS_SIZE bytes ($(du -h /vol1/1000/docker/moto-gps/map/china.pmtiles | awk '{print $1}'))"
echo "容器内文件大小:     $CONTAINER_SIZE bytes"
if [ "$NAS_SIZE" = "$CONTAINER_SIZE" ]; then
  echo "✓ 大小一致"
else
  echo "✗ 大小不一致!检查 docker-compose.yml volume mount"
fi

# 5. 单连接 1MB Range 测速
echo ""
echo "[5] 单连接 1MB Range 测速(localhost 直连)"
echo "---"
time docker exec moto-gps-backend wget -O /dev/null \
  --header="Range: bytes=0-1048575" \
  -S http://localhost:8788/china.pmtiles 2>&1 | grep -E "Length|saved"
echo "--- 期望 < 0.5s,速度 > 50 MB/s(SSD) ---"

# 6. 6 并发测速(模拟 app 客户端 6 并发)
echo ""
echo "[6] 6 并发 Range 测速(模拟 app 客户端)"
echo "---"
for i in 1 2 3 4 5 6; do
  docker exec moto-gps-backend wget -O /dev/null \
    --header="Range: bytes=0-65535" \
    -w "req $i: speed=%{speed_download} bytes/s  time=%{time_total}s\n" \
    http://localhost:8788/china.pmtiles 2>&1 | tail -1 &
done
wait
echo "--- 6 个 req 应该都 < 0.2s ---"

# 7. backend 启动日志(看启动用了什么 URL)
echo ""
echo "[7] backend 启动日志(确认用 localhost:8788)"
echo "---"
docker logs moto-gps-backend 2>&1 | tail -20
echo "--- 应看到 'map source: http://localhost:8788/china.pmtiles' 之类 ---"

# 8. backend 实际启动后有没有拉过 tile 头部?(看网络包量)
echo ""
echo "[8] 后端当前状态(是否 healthy + 启动了 map provider)"
echo "---"
docker exec moto-gps-backend sh -c '
  if [ -f /app/.cache/map-tiles/source-*.json ]; then
    echo "✓ source 缓存文件存在:"
    cat /app/.cache/map-tiles/source-*.json
    echo ""
  else
    echo "⚠ 还没触发过 PMTiles 拉取(head 端点)"
  fi
'

# 9. frp 测速(从公网拉到 PMTiles,如果有的话)
echo ""
echo "[9] (可选)公网 frp 测速"
echo "---"
echo "如果你配了 frpc 把 127.0.0.1:8788 暴露到 VPS,在电脑上跑:"
echo "  curl -o /dev/null --range 0-1048575 \\"
echo "    -w \"speed: %{speed_download} bytes/s\\n\" \\"
echo "    http://<你的VPS>:<remote_port>/china.pmtiles"

echo ""
echo "═══════════════════════════════════════════════"
echo "  测试完成"
echo "═══════════════════════════════════════════════"