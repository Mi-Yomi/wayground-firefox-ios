require 'xcodeproj'
require 'fileutils'
require 'json'

root = File.expand_path('../..', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'firefox-ios/Client.xcodeproj'))
client = project.targets.find { |target| target.name == 'Client' }
raise 'Client target missing' unless client
FileUtils.cp(File.join(root, 'wayground-dots/src/WaygroundDotsBridge.swift'), File.join(root, 'firefox-ios/Client/WaygroundDotsBridge.swift'))

source = project.files.find { |file| file.path == 'Client/WaygroundDotsBridge.swift' }
source ||= project.main_group.new_file('Client/WaygroundDotsBridge.swift')
client.source_build_phase.add_file_reference(source, true)
resources = project.files.find { |file| file.path == 'Client/WaygroundDotsResources' }
resources ||= project.main_group.new_file('Client/WaygroundDotsResources')
resources.last_known_file_type = 'folder'
client.resources_build_phase.add_file_reference(resources, true)

# LiveContainer does not register guest app extensions.
client.copy_files_build_phases.select { |phase| phase.name == 'Embed App Extensions' }.each(&:remove_from_project)
client.dependencies.select { |dependency| dependency.target&.product_type == 'com.apple.product-type.app-extension' }.each(&:remove_from_project)
client.build_configurations.each do |configuration|
  configuration.build_settings['MOZ_BUNDLE_ID'] = 'eu.miyomi.waygroundbrowser'
  configuration.build_settings['MOZ_BUNDLE_DISPLAY_NAME'] = 'Wayground Browser'
  configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'eu.miyomi.waygroundbrowser'
  configuration.build_settings['MOZ_INTERNAL_URL_SCHEME'] = 'waygroundbrowser'
  configuration.build_settings['MOZ_PUBLIC_URL_SCHEME'] = 'waygroundbrowser'
  configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  configuration.build_settings['CODE_SIGN_ENTITLEMENTS'] = ''
  configuration.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'WaygroundIcon'
  configuration.build_settings['ENABLE_DEBUG_DYLIB'] = 'NO'
end
project.save
info_path = File.join(root, 'firefox-ios/Client/Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info.delete('MozDevelopmentTeam')
info['CFBundleVersion'] = '2'
Xcodeproj::Plist.write_to_path(info, info_path)
icon_dir = File.join(root, 'firefox-ios/Client/Assets/AppIcons.xcassets/WaygroundIcon.appiconset')
FileUtils.mkdir_p(icon_dir)
FileUtils.cp(File.join(root, 'wayground-dots/extension/icon-1024.png'), File.join(icon_dir, 'icon.png'))
File.write(File.join(icon_dir, 'Contents.json'), JSON.pretty_generate({
  images: [{filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024'}],
  info: {author: 'xcode', version: 1}
}))
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(client)
scheme.set_launch_target(client)
scheme.save_as(project.path, 'Wayground', true)
puts 'Configured Wayground app target (iOS 17+, no guest extensions)'
