import urllib.request
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    response = urllib.request.urlopen(
        'https://localhost/api/favorites?username=146wyx',
        context=ctx
    )
    print("Status:", response.status)
    print("Response:", response.read().decode())
except Exception as e:
    print("Error:", e)
