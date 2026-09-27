/////////////////////////////////////////////////////////////////////////////
//
//  测试:PMTiles 自托管是否正常(NAS fnOS + docker-compose + nginx sidecar)
//
//  用法:在 NAS 部署根目录下执行(和 docker-compose.yml 同目录)
//        bash deploy/test-pmtiles-selfhost.sh
//
/////////////////////////////////////////////////////////////////////////////

# 1. 在 PMTiles 容器里能看到文件吗?
docker exec moto-gps-pmtiles ls -la /usr/share/nginx/html/
echo "--- 期望看到 china.pmtiles 文件 ---"

# 2. 容器内 wget 自检(应该 200)
docker exec moto-gps-pmtiles wget -O /dev/null -S http://127.0.0.1/health 2>&1 | head -10
echo "--- 期望看到 HTTP 200 OK ---"

# 3. 容器间 HTTP Range 测试(关键,后端用)
docker exec moto-gps-backend wget -O /tmp/range.bin \
  --header="Range: bytes=0-127" \
  http://pmtiles/china.pmtiles
xxd /tmp/range.bin | head -3
echo "--- 期望前 7 字节是 'PMTiles'(0x50 0x4D 0x54 0x69 0x6C 0x65 0x73) ---"

# 4. 文件大小一致吗?
NAS_SIZE=$(du -b /vol1/1000/docker/moto-gps/map/china.pmtiles 2>/dev/null | awk '{print $1}')
CONTAINER_SIZE=$(docker exec moto-gps-pmtiles stat -c '%s' /usr/share/nginx/html/china.pmtiles)
echo "NAS 实际大小:     $NAS_SIZE bytes"
echo "容器内文件大小:   $CONTAINER_SIZE bytes"
if [ "$NAS_SIZE" = "$CONTAINER_SIZE" ]; then
  echo "✓ 大小一致"
else
  echo "✗ 大小不一致!检查 volume mount 是否正确"
fi

# 5. 测速(关键指标)
echo "--- 单连接 1MB Range 测速 ---"
time curl -s -o /dev/null --range 0-1048575 \
  -w "speed_download: %{speed_download} bytes/s\ntime_total: %{time_total}s\n" \
  http://pmtiles/china.pmtiles
echo "期望: > 50 MB/s(SSD)  而不是 < 1 MB/s(跨国 Protomaps)"

# 6. 模拟客户端并发 6(模拟 app 修复后的并发):
echo "--- 6 并发 Range 测速 ---"
for i in $(seq 1 6); do
  curl -s -o /dev/null \
    --range $((RANDOM * 1000))-$((RANDOM * 1000 + 65535)) \
    -w "req $i: %{speed_download} bytes/s in %{time_total}s\n" \
    http://pmtiles/china.pmtiles &
done
wait

# 7. 后端日志(确认不再走 Protomaps)
echo "--- backend 最近日志 ---"
docker logs moto-gps-backend 2>&1 | tail -30
echo "--- 应看到 startup banner 含 'MOTO MAP_PMTILES_URL=http://pmtiles/...' ---"
