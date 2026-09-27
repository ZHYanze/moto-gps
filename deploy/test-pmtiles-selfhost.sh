/////////////////////////////////////////////////////////////////////////////
//
//  测试:能取到 PMTiles 文件头(PMTiles 文件头是前 7 字节 magic + metadata)
//
/////////////////////////////////////////////////////////////////////////////

# 1. 在 PMTiles 容器里能看到文件吗?
docker exec moto-gps-pmtiles ls -la /usr/share/nginx/html/

# 期望输出:
#   -rw-r--r-- ... china.pmtiles

# 2. 容器内 wget 自检(应该 200)
docker exec moto-gps-pmtiles wget -O /dev/null -S http://localhost/china.pmtiles 2>&1 | head -10

# 3. 容器间 HTTP Range 测试(关键,后端用)
docker exec moto-gps-backend wget -O /tmp/range.bin \
  --header="Range: bytes=0-127" \
  http://pmtiles/china.pmtiles

xxd /tmp/range.bin | head -3
# 前 7 字节应该是 "PMTiles" (0x50 0x4D 0x54 0x69 0x6C 0x65 0x73)

# 4. 文件大小一致吗?
docker exec moto-gps-pmtiles stat -c '%s' /usr/share/nginx/html/china.pmtiles
NAS 本地实际大小: du -b /volume1/.../china.pmtiles

# 5. 测速(单 tile,RFC 2326 cache 服务端不会用):
time curl -o /dev/null --range 0-65535 \
  -w "speed_download: %{speed_download} bytes/s\ntime_total: %{time_total}s\n" \
  http://pmtiles/china.pmtiles

# 期望: 速度 > 50 MB/s(本地 SSD + nginx) 而不是几百 KB/s

# 6. 在 NAS 上模拟客户端并发 6(模拟 app 修复后的并发):
for i in $(seq 1 6); do
  curl -s -o /dev/null \
    --range $((RANDOM * 1000))-$((RANDOM * 1000 + 65535)) \
    -w "req $i: %{speed_download} bytes/s in %{time_total}s\n" \
    http://pmtiles/china.pmtiles &
done
wait

# 7. 后端日志(应该看到 proxy http://pmtiles/... 不再走 Protomaps):
docker logs moto-gps-backend 2>&1 | grep -i "pmtiles\|map source\|http://" | tail -20
