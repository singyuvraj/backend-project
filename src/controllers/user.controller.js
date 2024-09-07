import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import { User } from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshTokens = async(userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({validateBeforeSave: false})

    return {accessToken, refreshToken}


  } catch (error) {
    throw new ApiError(500, "Something went wrong while generating refresh and access tokens");
    
  }
}

const registerUser =  asyncHandler( async (req, res) => {
  //LOGIC BUILDING

  // get user details from frontend
  // validation - not empty
  // check if user already exists: username, email
  // check for images, check for avatar
  // upload them to cloudinary, avatar
  // create user object - create entry in db
  // remove password and refresh token field from response
  // check for user creation
  // return res

  const {fullname, email, username, password } = req.body;
  console.log("email: ", email);

  // if (fullname === "") {
  //   throw new ApiError(404, "fullname is required")
  //   }

  if (
    [fullname, email, username, password].some((field) =>
    field?.trim() === "")
    ) {
      throw new ApiError(400, "All fields are required");
      
    }
  
    const existedUser = await User.findOne({
      $or: [{username}, {email}]
    })

    if (existedUser) {
      throw new ApiError(409, "User with email or username already exists"); 
    }
    // console.log(req.files);

    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
      coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
      console.error("Avatar file is missing in the request");
      throw new ApiError(400, "Avatar file is required");
    }

      const avatar = await uploadOnCloudinary(avatarLocalPath);
      const coverImage = await uploadOnCloudinary(coverImageLocalPath);

      if (!avatar) {
        throw new ApiError(400, "Failed to upload avatar file");
      }
         const user = await User.create({
          fullname,
          avatar: avatar.url,
          coverImage: coverImage?.url || "",
          email,
          password,
          username: username.toLowerCase()
          })

          const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
          )

          if (!createdUser) {
            throw new ApiError(500, "Something went wrong while registering the user");
          }

          return res.status(201).json(
            new ApiResponse(200, createdUser, "User registered successfully")
          )



} )

const loginUser = asyncHandler(async (req, res) => {
  //LOGIC BUILDING

  // req body -> data
  // username or email
  // find the user
  // check for password
  // check for access and refresh token
  // send cookies
  // return res

  const {email, username, password} = req.body;

  if (!email && !username) {
    throw new ApiError(400, "email or username is required")
  }

   const user = await User.findOne({
    $or: [{email}, {username}]
  })

  if (!user) {
    throw new ApiError(404, "User does not exist"); 
  }

  const isPasswordValid = await user.isPasswordCorrect(password)

  if (!isPasswordValid) {
    throw new ApiError(400, "Invalid credentials"); 
  }

  const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

  const loggedInUser = await User.findById(user._id).
  select("-password -refreshToken")

  const options = {
    httpOnly: true,
    secure: true
  }

  return res.
  status(200).
  cookie("accessToken", accessToken, options).
  cookie("refreshToken", refreshToken, options).
  json(
    new ApiResponse(200, 
      {
        user: loggedInUser,accessToken, refreshToken
      },
       "User logged in successfully")
  )

})

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id, 
    {
       $set: {
           refreshToken: "undefined"
       }
    },
    {
      new: true
    }
  )

  const options = {
    httpOnly: true,
    secure: true
  }

  return res
  .status(200)
  .clearCookie("accessToken", options)
  .clearCookie("refreshToken", options)
  .json(new ApiResponse(200, {}, "User logged out successfully"))


})

// REFRESH ACCESS TOKEN ka end point banatey hain

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
    if (!decodedToken) {
      throw new ApiError(401, "Unauthorized request");
    }
  
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }
  
    
    if (user?.refreshToken !== incomingRefreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }
  
    const options = {
      httpOnly: true,
      secure: true
    }
    
     const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id)
  
     return res
     .status(200)
     .cookie("accessToken", accessToken, options)
     .cookie("refreshToken", newRefreshToken, options)
     .json(new ApiResponse(200, {accessToken, refreshToken: newRefreshToken}, "Access token refreshed successfully"))
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const {oldPassword, newPassword} = req.body;

  const user = await User.findById(req.user?._id)
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Old password is incorrect");
  }

  user.password = newPassword;
  await user.save({validateBeforeSave: false});

  return res
  .status(200)
  .json(new ApiResponse(200, {}, "Password changed successfully"))

})

//fetching currentUser
const getCurrentUser = asyncHandler(async (req, res) => {
  return res
  .status(200)
  .json(new ApiResponse(200, req.user, "User fetched successfully"))
})

//Baaki details user ki jab update karni ho to
// agar koi file update karna ho to , uskey alag controller rakhna hai, better approach

const updateAccountDetails = asyncHandler(async (req, res) => {
  const {fullnamename, email} = req.body;

  if (!fullnamename && !email) {
    throw new ApiError(400, "Please provide at least one field to update");
  }
  // Ab fullname and email dono ko update karney ka information bhejtey hain - user find karna padega
  const user = await User.findByIdAndUpdate(
    req.user?._id, 
    {
       $set: {
           fullname,
           email: email
       }
    },
    {
      new: true // iska mtlb ,update hone ke baad jo information aati hai wo return hoti hai
    }
  ).select("-password");

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Account details updated successfully"))

})

//files upload karne ke liye 2 baat hain - 1) multer middleware use karna hai taaki files accept kar pao, 2) wahi log upload kar saktey hain jo logged In hon 

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path

  if (!avatarLocalPath) {
    throw new ApiError(400, "Please provide an avatar");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath)

  if(!avatar.url) {
    throw new ApiError(500, "Unable to upload avatar");
  }

  // ab karna hai update

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url
      }
    },
    {
      new: true
    }
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Avatar updated successfully"))


})

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path

  if (!coverImageLocalPath) {
    throw new ApiError(400, "Please provide a cover image");
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  if (!coverImage.url) {
    throw new ApiError(500, "Unable to upload cover image");
  }

  // ab karna hai update

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url
      }
    },
    {
      new: true
    }
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200, user, "Cover image updated successfully"))

})

//Mongodb Aggregation function

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const {username} = req.params;

  if (!username?.trim()) {
    throw new ApiError(400, "Please provide a username");
  }

const channel = await User.aggregate([
  {
    $match: {
      username: username?.toLowerCase()
    }
  },
  {
    $lookup: {
      from: "subscriptions",
      localField: "_id",
      foreignField: "channel",
      as: "subscribers"
    }
  },
  {
    $lookup: {
      from: "subscriptions",
      localField: "_id",
      foreignField: "subscriber",
      as: "subscribedTo"
    }
  },
  {
    $addFields: {
      subscribersCount: {
        $size: "$subscribers"
      },
      channelsSubscribedToCount: {
        $size: "$subscribedTo"
      },
      isSubscribed: {
        $cond: {
          if: {
            $in: [
              req.user?._id,
              "$subscribers.subscriber"]},
              then: true,
              else: false
        }
      }
    }
  },
  {
    $project: {
      fullname: 1,
      email: 1,
      username: 1,
      avatar: 1,
      coverImage: 1,
      subscribersCount: 1,
      channelsSubscribedToCount: 1,
      isSubscribed: 1
    }
  }
])

if (!channel?.length) {
  throw new ApiError(404, "Channel not found");
}

return res
.status(200)
.json(new ApiResponse(200, channel[0], "Channel profile fetched successfully"))

})

export { 
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile
 }