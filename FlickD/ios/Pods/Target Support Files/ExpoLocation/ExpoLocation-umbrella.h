#ifdef __OBJC__
#import <UIKit/UIKit.h>
#else
#ifndef FOUNDATION_EXPORT
#if defined(__cplusplus)
#define FOUNDATION_EXPORT extern "C"
#else
#define FOUNDATION_EXPORT extern
#endif
#endif
#endif

#import "EXLocation.h"
#import "EXBackgroundLocationPermissionRequester.h"
#import "EXBaseLocationRequester.h"
#import "EXForegroundPermissionRequester.h"
#import "EXLocationPermissionRequester.h"
#import "EXGeofencingTaskConsumer.h"
#import "EXLocationTaskConsumer.h"

FOUNDATION_EXPORT double ExpoLocationVersionNumber;
FOUNDATION_EXPORT const unsigned char ExpoLocationVersionString[];

