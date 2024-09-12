# Klik Aan Klik Uit ICS-2000 Homebridge Plugin

This Homebridge plugin provides HomeKit support for the ICS-2000 (KAKU). It requires your KAKU credentials for encryption and device state updates. Although the plugin operates locally, it communicates with the cloud for device status.

### Basic Config Example

```json
{
  "platform": "KAKU-ICS2000",
  "name": "ICS-2000",
  "email": "johndoe@email.com",
  "password": "password123"
}
```

### Optional Configs:
- `deviceBlacklist`: Array of device IDs to exclude.
- `localBackupAddress`: IP fallback if ICS-2000 is not automatically found.
- `deviceConfigOverrides`: Customize device behaviors (e.g., dimming).

### Full Config Example

```json
{
  "platform": "KAKU-ICS2000",
  "name": "ICS-2000",
  "email": "johndoe@email.com",
  "password": "password123",
  "deviceBlacklist": [22204109, 21053004],
  "localBackupAddress": "192.168.1.5",
  "deviceConfigOverrides": {
    "6": {
      "modelName": "ACDB 7000A doorbell",
      "onOffFunction": 0
    }
  }
}
```

### Features
| Done? | Feature |
|-------|---------|
| ✅    | Configurable device settings (dimmable, color temp) |
| ✅    | REST server for control and status updates |
| ❌    | CLI script to control devices |

### Contributing
Help by reporting device types or contributing to issues and PRs.

Acknowledge [ICS2000-Python](https://github.com/Stijn-Jacobs/ICS2000-Python) for foundational research.
