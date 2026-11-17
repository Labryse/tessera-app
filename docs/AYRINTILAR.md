# Tessera: ayrıntılar

Kaynaklar, gizlilik, bağlantılar, sürüm çıkarma ve geliştirme üzerine teknik notlar. Kısa tanıtım için [README](../README.md).

## Çalıştırma

Klasördeki **Tessera.bat** dosyasına çift tıkla ya da:

```bash
npx tauri dev
```

Yalnızca arayüz üzerinde çalışmak için (`npm run dev`, tarayıcıda) uygulama **örnek kütüphane** ile açılır. Masaüstü uygulaması ise her zaman kullanıcının kendi verisiyle ve ilk açılışta boş gelir.

## Hesap bağlama ilkeleri

Tessera yayınlanabilir bir uygulama olarak tasarlandı; hiçbir hesap gömülü değil.

- Hiçbir hesap kendiliğinden bağlanmaz. Kullanıcı Hesaplar ekranından kendisi seçer.
- Giriş platformun kendi sayfasında yapılır (Steam: OpenID). Tessera şifre görmez. Steam'in döndürdüğü imza Steam'e geri sorularak doğrulanır.
- İsteğe bağlı anahtarlar (Steam Web API anahtarı) **Windows Kimlik Bilgisi Yöneticisi**'nde saklanır, veritabanına yazılmaz.
- Oyun verileri `%APPDATA%\app.tessera.desktop\tessera.db` içinde durur. Tessera'nın bir sunucusu yoktur.
- "Bağlantıyı kes" hesabı ve anahtarı siler; istenirse o platformun oyunlarını da kaldırır.

## Steam

| Kaynak | Anahtar gerekir mi | Ne verir |
|---|---|---|
| Steam istemcisinin yerel dosyaları (`appmanifest`, `localconfig.vdf`) | Hayır | Yüklü oyunlar, boyut, oynama süresi ve son oynama (bu bilgisayarda açılmış oyunlar) |
| `IStoreBrowseService/GetItems` | Hayır | Ad, Türkçe açıklama, geliştirici, kapak, banner, ekran görüntüleri |
| `GetGlobalAchievementPercentagesForApp` | Hayır | Başarım sayısı ve nadirlik |
| `GetOwnedGames`, `GetPlayerAchievements` | Kullanıcının kendi anahtarı | Hiç açılmamış oyunlar, açılan başarımlar |

Kullanıcı düzenlemeleri (durum, puan, notlar, etiketler, koleksiyonlar) eşitlemede asla ezilmez.

## Diğer bağlantılar (isteğe bağlı)

- **RetroAchievements**: kullanıcı adı + Web API anahtarı. ROM'un MD5'i ile oyun bulunur (NES'te iNES başlığı atılır), başarımlar ve ilerleme ROM sayfasında görünür.
- **SteamGridDB**: ücretsiz API anahtarı. Oyun sayfasındaki resim düğmesinden başka kapak, banner ve logo seçilir; seçim kullanıcı verisine yazılır, eşitlemede ezilmez.
- Anahtarlar yine Windows Kimlik Bilgisi Yöneticisi'nde durur.

## Filtreler ve kategoriler

- Kütüphanede **Filtreler** paneli: tür, Steam etiketleri, özellikler (co-op, kumanda desteği, Steam Deck, bulut kaydı…), durum, mağaza, kurulum ve boyut, oynama süresi, son oynama, Metacritic, Steam kullanıcı puanı, kendi puanın, çıkış yılı, kategori.
- Sıralama: son oynanan, ad, süre, puanım, Metacritic, Steam kullanıcı puanı, çıkış tarihi, eklenme, boyut, tür; artan/azalan. Türe, mağazaya, duruma, yıla, Metacritic aralığına ya da kategoriye göre gruplanabilir.
- **Kategoriler** (Steam'deki koleksiyonlar gibi): elle doldurulan kategoriler ve filtrelerden oluşan **dinamik kategoriler**. Sağ tıkla yeniden adlandırılır ya da silinir; filtrelenmiş listenin hepsi tek seferde bir kategoriye eklenebilir.
- Etiket, özellik ve kullanıcı puanı Steam'den toplu gelir. Metacritic ve tür arka planda yavaşça dolar (Steam saniyede yaklaşık bir isteğe izin veriyor).

## Oyun içi durum

Oyun açıkken oyunun kendi paylaştığı satır ("Dereceli · Dust II", "Link Hyrule Field'da") kenar çubuğunda ve oyun sayfasında görünür; oturumun son satırı Oturumlar sekmesinde "Kaldığın yer" olarak kalır. Yalnızca bir oyun çalışırken sorulur.

- **Steam:** bağlı hesabın Steam profil kartındaki satır (15 sn'de bir). Steam profilinde oyun ayrıntıları görünür olmalı ve Steam "görünmez" olmamalı. Satırı yalnızca durum bilgisi yayınlayan oyunlar verir.
- **RetroAchievements:** emülatör RetroAchievements'a giriş yapmışsa kullanıcının durum satırı (dakikada bir). ROM'un RetroAchievements kimliği eşleşmezse gösterilmez.
- **Counter-Strike 2, Dota 2:** oyun sayfasında "Canlı maç bilgisi" açılınca oyunun `cfg` klasörüne `gamestate_integration_tessera.cfg` yazılır; oyun durumu yalnızca `127.0.0.1:47614`'e, Tessera'nın ürettiği bir anahtarla gönderilir (harita, skor, K/D/A, kahraman, süre).
- **Rocket League:** aynı düğme oyunun `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini` dosyasında `PacketSendRate=2` yapar; skor, süre, gol ve kurtarışlar `127.0.0.1:49123`'ten okunur.
- **League of Legends:** maç sırasında oyunun kendi yerel adresinden (`127.0.0.1:2999`) okunur, ayar gerekmez.
- Battle.net, EA, Ubisoft gibi istemciler bunu dışarı vermez; o oyunlarda yalnızca süre görünür.

## Steam'den gelenler (anahtarsız)

- **Güncellemeler:** her oyunun sayfasında "Haberler" sekmesi; kenar çubuğunda yüklü, favori ve son dört ayda oynanan oyunların son 45 günlük duyuruları ve yama notları. Steam'in resmî duyuru akışı, birkaç saat önbellekte.
- **Ekran görüntüleri:** Steam'in bu bilgisayarda tuttuğu ekran görüntüleri (`userdata\<hesap>\760\remote\<appid>\screenshots`) oyun sayfasında. Pencereye yalnızca bu klasörlerdeki resimler `shot` protokolüyle verilir.
- **İstek listesi:** Steam profilindeki istek listesi fiyatlarla; indirime giren ya da çıkan oyunlar altı saatte bir kontrol edilip bildirilir. Tessera'nın gördüğü en düşük fiyat saklanır. Profilde oyun ayrıntıları herkese açık olmalı.
- **Arkadaşlar:** herkese açık arkadaş listesinden kim oyunda, ne oynuyor ve oyunun paylaştığı satır. Sayfa açıkken dakikada bir yenilenir.
- **Ne oynasam?:** süre seçenekleri ("Bir akşamlık", "Hafta sonuluk", "Uzun soluklu") HowLongToBeat süresi yoksa Steam etiketlerinden tahmin edilir.
- **Yıllık özet:** oyunu "Bitirdim" ya da "%100" yaptığın gün kaydedilir; özette o yıl bitirdiklerin görünür.
- **Steam profilindeki ekran görüntüleri:** profile yüklenenler (herkese açık profil sayfasından) "Steam profili" sekmesinde, bu bilgisayardakiler "Bu bilgisayar" sekmesinde.

## Mağazalardaki fiyatlar (IsThereAnyDeal)

- Oyun sayfasındaki **Mağazalar** bölümü oyunu satan mağazaları (Steam, GOG, Epic, Fanatical, Humble, GreenManGaming…) Türkiye fiyatlarıyla, en ucuzu işaretli listeler; gördüğü en düşük fiyatı da yazar. İstek listesindeki her kartta Steam'den ucuz bir mağaza varsa o görünür.
- Oyun önce Steam kimliğiyle, yoksa adıyla bulunur (anahtar gerekmez). Fiyatlar için anahtar gerekir: yayınlanan sürüm kendi anahtarıyla gelir (sürüm iş akışı `TESSERA_ITAD_KEY` gizli değişkenini derlerken gömer; kodda yok). Kullanıcı isterse kendi ücretsiz anahtarını girer ve o öncelikli olur: isthereanydeal.com → Uygulamalarım → yeni uygulama → API Key → Ayarlar → Hesaplar → IsThereAnyDeal. Kullanıcının anahtarı Windows Kimlik Bilgisi Yöneticisi'nde durur.
- Fiyatlar 6 saat önbellekte; istek listesinin hepsi iki istekte gelir. Gömülü anahtarın sınırı bütün kullanıcılar için ortaktır (5 dakikada 1000 istek); aşılırsa "biraz sonra dene" yazar.
- Bir mağazaya tıklamak IsThereAnyDeal'ın verdiği bağlantıyı değiştirmeden açar (kullanım şartları: bağlantılardaki ortaklık etiketleri kalır). Yalnızca Steam, ortaklık programı olmadığı için, yüklüyse kendi uygulamasında açılır.
- **Fiyat ara** sekmesi sahip olunmayan oyunlar için: ad yazılır, sonuçlar her oyunun en ucuz fiyatıyla gelir (arama + fiyatlar iki istek, bir gün önbellekte). Arama boşken IsThereAnyDeal'ın en popüler oyunlarından kütüphanede olmayan, satışta ücretli 18 tanesi rastgele gelir (liste bir gün, görseller bir hafta önbellekte); “Başkaları” yeni bir seçki çeker. Oyuna girince çıkış tarihi, geliştirici, inceleme puanları ve tüm mağazalar görünür; kütüphanede varsa oyuna gitme bağlantısı çıkar.

## Geniş ekran (TV ve kumanda)

- Kenar çubuğundaki **Geniş ekran**, F11 ya da kumandada Start açar (Ayarlar → Kütüphane'den kapatılabilir). Pencere tam ekrana geçer.
- Raflar: Kaldığın yerden, Yüklü, Favoriler, retro sistemler, Tüm oyunlar. Odaktaki oyunun görseli ekranı kaplar.
- Açılışta logonun kareleri birleşir, ardından raflar yükselir (Ayarlar → Animasyonlar “Az” iken atlanır). Kumanda: yön tuşu/sol çubuk gezer, A oyunun sayfasını açar (Oyna, Favori, Masaüstünde aç), Y favori, LB/RB raf değiştirir, B geri döner ya da çıkmayı sorar. PlayStation kumandasında tuş işaretleri ona göre çizilir. Klavye: oklar, Enter, Esc, I, F, PgUp/PgDn.
- Tessera'nın penceresi odakta değilken kumanda okunmaz; oyun içinde basılan tuşlar Tessera'ya ulaşmaz.

## Arkadaşlar

- Her platform kendi sekmesinde ve kendi renklerinde: Steam (bağlı hesabın herkese açık arkadaş sayfası, anahtarsız) ve Xbox (kullanıcının ücretsiz OpenXBL anahtarı: xbl.io → API Keys → Ayarlar → Hesaplar → Xbox arkadaşları). Epic arkadaş listesini dışarıya açmadığı için yok.
- Steam'de bir arkadaşın profil kartı o an yanıt vermezse oyunun görseli kaybolmasın diye oyunun Steam kimliği adıyla hatırlanır; görsel adresi de ilk yüklenen hangisiyse o kullanılır.

## Temalar

Graphite, Linen, Sorbet (pastel), Synth (neon), Bauhaus (geometrik), Abyss (derin deniz), Ember (sıcak). Renklerin yanında her temanın kendi arka planı, köşeleri ve başlık/menü/buton dokunuşları var (`src/styles/themes.css`).

### Topluluk temaları

- Ayarlar → Görünüm → **Tema oluştur**: yerleşik temalardan biri temel alınır, 10 renk ve köşeler seçilir; her değişiklik bütün pencerede o an görünür. Kaydedilen tema uygulamanın `themes` klasörüne JSON olarak yazılır.
- **Dışa aktar** o dosyayı paylaşmak için kaydeder, **İçe aktar** başkasının temasını ekler; klasör simgesi `themes` klasörünü açar.
- Dosya biçimi: `{ "name", "author", "base", "colors": { ground, surface, raised, border, text, muted, accent, accentInk, positive, negative }, "radius", "background", "css" }`. `css` ve `background` ağa çıkamaz: `@import` ve `data:` dışındaki `url(...)` atılır.

## Dil

Türkçe ve İngilizce (Ayarlar → Görünüm → Dil, ya da hoş geldin rehberi). İlk açılışta Windows'un diline göre seçilir. Türkçe metin kodun içinde `t('…')` ile yazılır ve İngilizce tablonun anahtarıdır (`src/i18n/`); tabloda olmayan satır Türkçe görünür, geliştirirken tarayıcı konsolu eksikleri yazar. Rust tarafındaki hata ve bildirim metinleri `tr!` / `l()` ile iki dilli; Steam'den gelen mağaza metni, etiketler ve başarımlar da seçilen dilde istenir (önbellekteki eski bilgiler süresi dolunca yenilenir).

## Hoş geldin rehberi

Boş bir Tessera ilk açıldığında üç adım: dil ve tema, mağazaları bağlama, bulunan oyun sayısı ve kısayollar. Ayarlar → Hakkında → **Hoş geldin rehberi** yeniden açar.

## Fiyat takibi

Fiyat ara'da bir oyunun sayfasında **Takip et**. İstenirse hedef fiyat yazılır. Altı saatte bir (istek listesiyle birlikte) takip edilen oyunların fiyatına yeniden bakılır; fiyat takibe alındığı andakinden düşükse ya da hedef fiyata indiyse Windows bildirimi gelir, aynı fiyat iki kez bildirilmez. Takip edilenler Fiyat ara'nın üstünde, değişimiyle birlikte görünür. Ayarlar → Açılış ve arka plan'dan bildirimi kapatılabilir.

## Hata raporu

Pencerede yakalanmamış bir hata olunca köşede "Bir şey ters gitti · Bildir" çıkar (Ayarlar → Veri ve gizlilik'ten kapatılabilir); Ayarlar → Hakkında → **Hata bildir** her zaman açar. Rapor kendiliğinden hiçbir yere gitmez: kullanıcı metnin tamamını görür, düzenler ve ya kopyalar ya da deponun GitHub sayfasında kendi hesabıyla issue olarak açar. Kullanıcı klasörü, e-posta, anahtarlar ve SteamID'ler metinden çıkarılır. Rust tarafındaki çökmeler uygulama klasöründeki `errors.log`'a yazılır ve rapora eklenir.

## Oynanan oyun

- Açık oyunun yanında etiket ya da yanıp sönen işaret yok: süre işler ve altındaki ince çizgi, o oyundaki her zamanki oturum süresine (son oturumların ortancası, en az 3 oturum) doğru dolar.

## Aynı oyunun kopyaları

Bir oyun birden çok mağazada varsa (Steam ve Epic gibi) tek kartta görünür: hemen oynanabilen kopya öne geçer, süreler toplanır, oyun sayfasında "Kopyalar" bölümü her kopyayı kendi düğmesiyle listeler. Eşleşme önce Steam kimliğiyle, yoksa sürüm ekleri ("Deluxe Edition", "GOTY"…) atılmış adla yapılır; iki farklı Steam kimliği hiçbir zaman birleşmez, retro ROM'lar birleşmez. Ayarlar → Kütüphane'den kapatılabilir.

## Arka plan ve bildirimler

- Pencere kapanınca tepsiye iner, süreler sayılmaya devam eder. İkinci kez açılırsa var olan pencere öne gelir.
- Windows açılınca başlatma (`HKCU\…\Run`, `--hidden` ile, sessiz).
- İstek listesi altı saatte bir kontrol edilir; indirim ve çıkış için Windows bildirimi.
- Bildirimler yalnızca kurulum dosyasıyla yüklenmiş Tessera'da "Tessera" adıyla görünür. `target\release` ya da `target\debug` içinden çalıştırılan sürümde Windows bildirimi PowerShell adına gösterir (Tauri'nin bildirim eklentisi böyle yapıyor).

## Veritabanı onarımı

Tessera her açılışta veritabanını kısaca denetler. Hata bulursa dosyaları `backup-damaged-<zaman>` klasörüne olduğu gibi kopyalar, okunabilen her satırı yeni bir veritabanına taşır (aynı kayıt iki kez yazılmışsa en yenisi kalır) ve kullanıcıya bir kez söyler.

## Güncelleme

Sürümler GitHub Actions'ta kaynak koddan derlenir (`.github/workflows/release.yml`). Yerelde derlenen Tessera güncelleme aramaz; iş akışının derlediği sürüm, deponun son sürümündeki `latest.json`'a bakar (adres derlerken deponun adından yazılır, çatallar kendi depolarına bakar).

1. `src-tauri/tauri.conf.json` içinde `version` değerini yükselt, gönder.
2. GitHub → Actions → Release → Run workflow. İmzalı kurulum dosyası ve `latest.json` taslak bir sürüme yüklenir.
3. Taslağı kontrol edip yayınla; kurulu Tessera'lar onu bulur.

Deponun gizli değişkenleri (Settings → Secrets and variables → Actions): `TAURI_SIGNING_PRIVATE_KEY` (anahtar dosyasının içeriği), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, isteğe bağlı `TESSERA_ITAD_KEY`, `TESSERA_GOOGLE_CLIENT_ID`, `TESSERA_GOOGLE_CLIENT_SECRET`.

İmza anahtarı projede değil, `%USERPROFILE%\.tauri\tessera.key` içinde. Kaybolursa kurulu Tessera'lar bir daha güncellenemez; güvenli bir yerde yedeğini tut. Elle sürüm için `scripts\release.ps1` de duruyor.

## Yedek

Ayarlar → Veri ve gizlilik → **Dışa aktar** tek bir JSON yazar: her oyunun kullanıcı verisi (durum, puan, notlar, inceleme, etiketler, seçilen görseller), Tessera'nın saydığı oturumlar, koleksiyonlar ve tercihler. **İçe aktar** hiçbir şeyi silmez; boş alanları doldurur, notları ve etiketleri birleştirir, aynı oturumu iki kez eklemez. Kütüphanede henüz olmayan oyunlar sayılır ve hesap bağlanınca yeniden içe aktarılabilir.

## Kurulum dosyası

```bash
npx tauri build
```

Çıktı: `src-tauri/target/release/bundle/nsis/Tessera_0.1.0_x64-setup.exe` (yönetici izni istemez, kullanıcı klasörüne kurulur). İkon kaynağı `src-tauri/icons/tessera.svg`; değiştirince `npx tauri icon src-tauri/icons/tessera.svg`. Google Drive istemcisini sürüme gömmek için bkz. `KURULUM-GOOGLE-DRIVE.md`.

## Geliştirme

- Arayüz: `src/`, Rust: `src-tauri/src/` (`steam.rs`, `db.rs`, `vdf.rs`, `lib.rs`)
- Yerel Steam kurulumuna karşı testler: `cd src-tauri && cargo test -- --ignored --nocapture`
- Tarayıcı demosunun görselleri (mağaza görselleri, depoda yok, kurulum dosyasına da girmez): `node scripts/fetch-media.mjs`, `node scripts/fetch-achievements.mjs`
- Her gönderimde tip denetimi, lint ve Rust testleri çalışır (`.github/workflows/check.yml`).

## Lisans

GPL-3.0-or-later (`LICENSE`). Fiyatlar [IsThereAnyDeal](https://isthereanydeal.com/) API'sinden; Tessera onlarla bağlantılı değildir.
- Ekranlara doğrudan gitmek için (tarayıcı modu): `#game/1145350`, `#system/gba`, `#stats`, `#accounts`, `?theme=linen`
