# Wayground Browser для iPhone

Отдельный форк Firefox iOS с встроенным Wayground Dots. База: Mozilla Firefox iOS `release/v158.1`, коммит `f22e7683f16c8946f7e9f766b925cf8789639d9e`. iOS 17+, Xcode 26.5.

## Сборка и установка

1. В GitHub откройте Actions → **Build Wayground IPA** → **Run workflow**. Сборка не требует сертификата Apple.
2. После успешной сборки скачайте артефакт **WaygroundBrowser-IPA**. Распакуйте ZIP: внутри `WaygroundBrowser.ipa` и SHA-256.
3. Передайте IPA на iPhone через приложение «Файлы», iCloud Drive или AirDrop с Mac. В уже установленном LiveContainer выберите импорт приложения и этот IPA.
4. Откройте Wayground Browser из LiveContainer. Перейдите на `https://wayground.com/join` и войдите в свою учётную запись.
5. Кнопка Dots внизу слева открывает панель. «Подключить ИИ» открывает настройки. Укажите API-провайдера, ID модели и свой API-ключ, сохраните и выполните «Проверить ИИ». Эта проверка расходует лимит API.

Сборка IPA не подтверждает запуск в LiveContainer. Требуется реальная проверка на устройстве; её результат должен быть записан отдельно. Расширения Firefox для рабочего стола здесь не устанавливаются: Dots встроен в WebKit браузера.

## Поведение и данные

- Код Dots выполняется только в основном фрейме HTTPS-страниц `wayground.com` и `www.wayground.com`, в отдельном `WKContentWorld`.
- Зелёный означает совпавший публичный ключ, жёлтый — предположение ИИ. ИИ включается пользователем и не нажимает ответы.
- Сохраняются распознавание текущего вопроса, публичный источник/PIN, приоритет ключей, отмена устаревшего запроса, размер, видимость и перетаскивание кружков.
- В API передаются текущий вопрос и варианты. Изображения передаются только по отдельному разрешению. Cookies, имя игрока и PIN не отправляются провайдеру ИИ.
- Настройки ИИ с ключом хранятся в Keychain; прочие параметры и ограниченный кэш ответов — в локальных настройках приложения. Кнопка удаления ключа удаляет запись Keychain. При ошибке Keychain нет сохранения ключа в открытом виде.
- В LiveContainer гостевые приложения делят права и контейнер среды запуска; нельзя обещать ту же изоляцию, что при обычной установке. Не импортируйте недоверенные гостевые приложения рядом с ключами.
- Сеть обслуживает `URLSession` без cookies и хранилища паролей. Разрешены Wayground, изображения Wayground/Quizizz и сохранённый HTTPS API; HTTP-переадресации запрещены.
- Локальный компонент Codex для Windows и вход через него на iPhone не работают. Поддерживаются API OpenAI, Gemini и совместимые HTTPS API.
- Скрипт Tampermonkey и обход прокторинга в сборку не включены. Отдельный JS-контекст не скрывает изменения DOM от сайта.
- Гостевые `.appex` исключены: виджеты, Share Extension и расширение менеджера паролей не входят в IPA.

## Разработка

`src/browser-bridge.js` адаптирует WebExtension API. `src/WaygroundDotsBridge.swift` реализует проверку источника сообщений, Keychain, сеть и настройки. `scripts/build.mjs` собирает ресурсы из мобильной версии Dots. Готовые ресурсы хранятся в `firefox-ios/Client/WaygroundDotsResources` форка; `wayground-dots/extension` содержит их воспроизводимые исходники.

На Mac в корне форка:

```sh
./bootstrap.sh firefox
gem install xcodeproj -v 1.27.0 --no-document
node wayground-dots/scripts/build.mjs wayground-dots/extension firefox-ios/Client/WaygroundDotsResources
ruby wayground-dots/scripts/configure.rb
node --test wayground-dots/tests/*.test.mjs
xcodebuild -project firefox-ios/Client.xcodeproj -scheme Wayground -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build/Dots CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= CODE_SIGN_ENTITLEMENTS= build
bash wayground-dots/scripts/package.sh
```

Firefox и изменённые Swift-файлы распространяются по MPL 2.0. Происхождение Screening Choice и остальных компонентов сохранено в `THIRD_PARTY_NOTICES.txt`.
