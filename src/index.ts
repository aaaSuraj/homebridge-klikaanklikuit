export = (api: API) => {
  try {
    api.registerPlatform(PLATFORM_NAME, KAKUPlatform);
    console.log('Platform registered successfully');
  } catch (error) {
    console.error('Error registering platform:', error);
  }
};
