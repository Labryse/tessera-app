# Privacy

Tessera has no server of its own and collects no analytics or telemetry. Your library, play sessions, notes and settings stay in Tessera's data folder on your computer.

## Connections Tessera makes on its own

These requests carry no account details. The services see your IP address, as with any web request.

| Service | What for | What is sent |
| --- | --- | --- |
| GitHub (`github.com`) | Checking for a new Tessera version at start-up | Nothing beyond the request itself |
| Steam Store (`store.steampowered.com`, Steam image servers) | Details, images and news for the games in your library | Steam app IDs or game names |
| Wikipedia and Wikidata | Details for games that are not on Steam | Game names |
| IsThereAnyDeal (`api.isthereanydeal.com`) | Store prices on a game's page and for your wishlist | Game identifiers and the region |
| libretro database on GitHub (`raw.githubusercontent.com`) | Recognising ROM files, only after you add a ROM folder | Nothing beyond the request itself |

## Connections only after you link an account

No account is linked unless you choose to link it on the Accounts screen. Keys are kept in Windows Credential Manager, not in Tessera's database, and "Disconnect" deletes them.

| Service | What for | What is sent |
| --- | --- | --- |
| Steam (Web API, Steam Community) | Library, playtime, achievements, friends, what you are playing, screenshots, wishlist | Your SteamID and, if you add one, your Steam Web API key |
| RetroAchievements | Achievements for retro games | Your username and key |
| OpenXBL (`xbl.io`) | Xbox friends | Your OpenXBL key |
| SteamGridDB | Other artwork for a game | Your SteamGridDB key and the game's name |
| Google Drive | Syncing your Tessera backup | The backup file, in Tessera's own app folder in your Drive |

Games from Epic, GOG, Xbox, Battle.net, EA and Ubisoft are found through the launchers installed on your computer. Tessera does not sign in to those stores.

## Error reports

An error report never leaves your computer on its own. You see the full text, can edit it, and either copy it or open it as an issue on GitHub with your own account. Your user folder, e-mail addresses, keys and SteamIDs are removed from the text first.

## Changes to your system

Tessera changes system settings only when you ask: starting with Windows (a setting, off by default) and turning on a game's own statistics output where Tessera offers live match details. The installer adds an uninstaller to Windows' installed apps list.
