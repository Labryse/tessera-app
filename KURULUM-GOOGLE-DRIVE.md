# Google Drive kayıt senkronu: bir kerelik kurulum

Tessera'nın Google Drive'a bağlanabilmesi için Google, uygulamanın kendi "istemci kimliği" olmasını istiyor. Bunu **bir kez** sen oluşturursun; Tessera'yı kullanan herkes aynı kimlikle bağlanır. Ücretsizdir, yaklaşık 10 dakika sürer.

Tessera yalnızca `drive.appdata` iznini ister: Drive'ında Tessera'ya ait **gizli bir klasör**. Tessera Drive'ındaki başka hiçbir dosyayı göremez ve kayıtlar Drive dosyaların arasında görünmez.

## 1. Proje ve Drive API

1. https://console.cloud.google.com adresine git ve Google hesabınla giriş yap.
2. Üstteki proje seçicisinden **Yeni proje** oluştur, adına `Tessera` yaz.
3. Sol menüden **API'ler ve Hizmetler → Kitaplık**'a gir, **Google Drive API**'yi bul ve **Etkinleştir**'e bas.

## 2. İzin ekranı (OAuth consent screen)

1. **API'ler ve Hizmetler → OAuth izin ekranı** (yeni arayüzde **Google Auth Platform → Branding**).
2. Kullanıcı türü: **Harici (External)**.
3. Uygulama adı: `Tessera`; destek e-postası ve geliştirici e-postası: kendi adresin.
4. **Kapsamlar (Data access / Scopes)** adımında **Kapsam ekle**'ye bas ve şunu ekle:
   `https://www.googleapis.com/auth/drive.appdata`
   (`openid` ve `email` zaten varsayılandır.)
5. **Test kullanıcıları (Audience → Test users)**: kendi Gmail adresini ve Tessera'yı kullanacak arkadaşlarının adreslerini ekle (en fazla 100 kişi).

## 3. İstemci kimliği

1. **API'ler ve Hizmetler → Kimlik bilgileri → Kimlik bilgisi oluştur → OAuth istemci kimliği**.
2. Uygulama türü: **Masaüstü uygulaması (Desktop app)**. Ad: `Tessera`.
3. Oluşturduktan sonra açılan pencerede **JSON'u indir**'e bas. Dosyanın adı `client_secret_....json` gibi olur.

## 4. Tessera'da

1. **Ayarlar → Kayıt senkronu** (ya da **Emülatörler** sayfasının altı) → Google Drive kartında **Kurulum dosyasını seç** → indirdiğin JSON'u seç.
2. **Google ile bağlan**'a bas. Tarayıcında Google'ın kendi sayfası açılır.
3. "Google bu uygulamayı doğrulamadı" uyarısı çıkarsa bu normaldir (uygulama "Test" durumundayken). **Gelişmiş → Tessera'ya git (güvenli değil)** ile devam et ve izin ver.
4. "Tessera bağlandı" sayfası görününce sekmeyi kapat. Kayıtların ilk eşitlemesi kendiliğinden yapılır.

Başka bir bilgisayarda: Tessera'yı aç, aynı kurulum dosyasını seç (ya da yayınlanmış sürümde bu adım yoktur), **Google ile bağlan**. ROM'larını eklediğinde kayıtların kendiliğinden iner.

## Yayınlarken

- İstemci bilgilerini sürüme gömmek için derlerken iki ortam değişkeni ver; kullanıcılar kurulum dosyası seçmez:
  ```
  set TESSERA_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
  set TESSERA_GOOGLE_CLIENT_SECRET=...
  npx tauri build
  ```
  Masaüstü uygulamalarında bu "gizli anahtar" gerçekte gizli sayılmaz; Google da bunu bilir. Güvenliği PKCE ve yerel dönüş adresi sağlar.
- Herkesin kullanabilmesi için izin ekranında **Uygulamayı yayınla**'ya bas. `drive.appdata` hassas olmayan bir kapsam olduğu için Google genelde yalnızca marka doğrulaması ister (uygulama adı, logo, gizlilik politikası sayfası).

## Bağlantıyı kaldırmak

Tessera'da **Bağlantıyı kes** hem anahtarı bu bilgisayardan siler hem de Google'daki izni geri çeker. Google hesabından da elle kaldırabilirsin: https://myaccount.google.com/permissions
